import { Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { googleMinutes, settingsOf } from '../lib/dispatch.js';
import { driveMinutes } from '../lib/matching.js';

const MINUTE = 60000;
const FRESH_MINUTES = 15;

export default automation('eta_check', {
	description: 'Checks one visit’s live ETA without sharing another visit’s read dependencies.',
	input: { visit: { kind: 'id', of: 'visits' } },
	runAs: ['dispatch_automation'],
	concurrency: { max: 4 },
	run: function* ({ visit }, ctx) {
		const now = Date.parse(ctx.now);
		const { settings, current } = yield* Effect.all(
			{
				settings: settingsOf(ctx),
				current: ctx.query('visits', {
					where: { id: { eq: visit } },
					select: {
						revision: true,
						number: true,
						status: true,
						slot: true,
						location: true,
						attention: true,
						helper: { select: { name: true, last_location: true, last_location_at: true } }
					},
					limit: 1
				})
			},
			{ concurrency: 'unbounded' }
		);
		const v = current.rows[0];
		if (
			v === undefined ||
			v.status !== 'scheduled' ||
			v.helper === null ||
			Date.parse(v.slot.start) < now ||
			Date.parse(v.slot.start) >= now + settings.eta_check_lead_minutes * MINUTE
		)
			return;
		const helper = v.helper;
		const from = helper.last_location;
		const fresh =
			from !== null &&
			helper.last_location_at !== null &&
			now - Date.parse(helper.last_location_at) <= FRESH_MINUTES * MINUTE;
		let eta = fresh ? driveMinutes(from, v.location) : null;
		if (
			from !== null &&
			v.location !== null &&
			eta !== null &&
			eta > settings.eta_limit_minutes / 2
		) {
			const live = yield* googleMinutes(ctx, from, [v.location], true);
			eta = live?.[0] ?? eta;
		}
		const late = eta === null || eta > settings.eta_limit_minutes;
		// ETA owns only its own warning; dispatch warnings remain in place.
		const attention: typeof v.attention =
			v.attention !== 'none' && v.attention !== 'eta_risk'
				? v.attention
				: late
					? 'eta_risk'
					: 'none';
		const written = yield* ctx
			.act(
				'visits.update',
				{ target: v.id, set: { eta_minutes: eta, eta_checked_at: ctx.now, attention } },
				{ observed: { [v.id]: v.revision } }
			)
			.pipe(
				Effect.as(true),
				Effect.catchTag('ActConflict', () => Effect.succeed(false))
			);
		// A concurrent recovery plan keeps its write; the next watch checks this visit afresh.
		if (!written || !late) return;
		yield* ctx.notify({
			title: `Call ${helper.name} about ${v.number}`,
			to: [{ team: 'operations' }],
			description:
				eta === null
					? 'Their app has not reported a position in the last 15 minutes.'
					: `They are about ${eta} minutes away. Reassign the visit if they cannot make it.`,
			link: { collection: 'visits', id: v.id },
			once: `eta-${v.id}`
		});
	}
});
