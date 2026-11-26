import { DateTime, Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { googleMinutes, routesAccount, settingsOf, targetOf } from '../lib/dispatch.js';
import { driveMinutes } from '../lib/matching.js';

const FRESH_MINUTES = 15;

export default automation({
	description: 'Checks one appointment’s live GPS ETA and flags ETA risk for operations when late.',
	input: { appointment: { kind: 'ref', to: 'appointments' } },
	policies: ['dispatch_automation'],
	concurrency: { max: 4 },
	run: function* ({ appointment }, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const { settings, current } = yield* Effect.all(
			{
				settings: settingsOf(ctx),
				current: ctx.query({
					appointments: {
						where: { id: { eq: appointment } },
						fields: ['revision', 'number', 'status', 'slot', 'location', 'attention', 'provider'],
						limit: 1,
						provider: { fields: ['name', 'last_location', 'last_location_at'] }
					}
				})
			},
			{ concurrency: 'unbounded' }
		);
		const a = current.appointments.rows[0];
		if (
			a === undefined ||
			a.status !== 'scheduled' ||
			a.provider === null ||
			DateTime.isLessThan(DateTime.makeUnsafe(a.slot.start), now) ||
			DateTime.isGreaterThanOrEqualTo(
				DateTime.makeUnsafe(a.slot.start),
				DateTime.add(now, { minutes: settings.eta_check_lead_minutes })
			)
		)
			return;
		const provider = a.provider;
		const from = provider.last_location;
		const at = provider.last_location_at;
		const fresh =
			from !== null &&
			at !== null &&
			DateTime.isLessThanOrEqualTo(
				now,
				DateTime.add(DateTime.makeUnsafe(at), { minutes: FRESH_MINUTES })
			);
		let eta = fresh ? driveMinutes(from, a.location) : null;
		if (
			from !== null &&
			a.location !== null &&
			eta !== null &&
			eta > settings.eta_limit_minutes / 2
		) {
			const account = yield* routesAccount(ctx);
			const live = yield* googleMinutes(ctx, account, from, [a.location], true);
			eta = live?.[0] ?? eta;
		}
		const late = eta === null || eta > settings.eta_limit_minutes;
		const attention: typeof a.attention =
			a.attention !== 'none' && a.attention !== 'eta_risk'
				? a.attention
				: late
					? 'eta_risk'
					: 'none';
		const written = yield* ctx
			.act(
				{
					'appointments.update': [
						{ target: targetOf(a), set: { eta_minutes: eta, eta_checked_at: ctx.now, attention } }
					]
				},
				{ key: `eta-check:${a.id}:${a.revision}` }
			)
			.pipe(
				Effect.as(true),
				Effect.catchTag('ActConflict', () => Effect.succeed(false))
			);
		if (!written || !late) return;
		yield* ctx.notify({
			title: `Check in with ${provider.name} about ${a.number}`,
			to: [{ policy: 'operations' }],
			description:
				eta === null
					? 'Their mobile app has not reported a GPS position in the last 15 minutes.'
					: `Estimated travel time is ${eta} minutes. Reassign the appointment if they cannot arrive on time.`,
			link: { model: 'appointments', id: a.id },
			once: `eta-${a.id}`
		});
	}
});
