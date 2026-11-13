import { DateTime, Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { routesAccount, googleMinutes, settingsOf, targetOf } from '../lib/dispatch.js';
import { driveMinutes } from '../lib/matching.js';

const FRESH_MINUTES = 15;

export default automation({
	description: 'Checks one visit’s live ETA without sharing another visit’s read dependencies.',
	input: { visit: { kind: 'ref', to: 'visits' } },
	policies: ['dispatch_automation'],
	concurrency: { max: 4 },
	run: function* ({ visit }, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const { settings, current } = yield* Effect.all(
			{
				settings: settingsOf(ctx),
				current: ctx.query({
					visits: {
						where: { id: { eq: visit } },
						fields: ['revision', 'number', 'status', 'slot', 'location', 'attention', 'helper'],
						limit: 1,
						helper: { fields: ['name', 'last_location', 'last_location_at'] }
					}
				})
			},
			{ concurrency: 'unbounded' }
		);
		const v = current.visits.rows[0];
		if (
			v === undefined ||
			v.status !== 'scheduled' ||
			v.helper === null ||
			DateTime.isLessThan(DateTime.makeUnsafe(v.slot.start), now) ||
			DateTime.isGreaterThanOrEqualTo(
				DateTime.makeUnsafe(v.slot.start),
				DateTime.add(now, { minutes: settings.eta_check_lead_minutes })
			)
		)
			return;
		const helper = v.helper;
		const from = helper.last_location;
		const at = helper.last_location_at;
		const fresh =
			from !== null &&
			at !== null &&
			DateTime.isLessThanOrEqualTo(
				now,
				DateTime.add(DateTime.makeUnsafe(at), { minutes: FRESH_MINUTES })
			);
		let eta = fresh ? driveMinutes(from, v.location) : null;
		if (
			from !== null &&
			v.location !== null &&
			eta !== null &&
			eta > settings.eta_limit_minutes / 2
		) {
			const account = yield* routesAccount(ctx);
			const live = yield* googleMinutes(ctx, account, from, [v.location], true);
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
			.act({
				'visits.update': [
					{ target: targetOf(v), set: { eta_minutes: eta, eta_checked_at: ctx.now, attention } }
				]
			})
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
			link: { model: 'visits', id: v.id },
			once: `eta-${v.id}`
		});
	}
});
