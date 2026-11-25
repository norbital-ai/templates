import { DateTime, Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { settingsOf } from '../lib/dispatch.js';

/**
 * Fans out independent `eta_check` runs for every scheduled appointment inside the ETA lead window
 * so each appointment reads and updates its own scope without cross-appointment conflicts.
 */
export default automation({
	description:
		'Schedules live GPS ETA checks every five minutes for appointments starting within the configured ETA lead window.',
	on: [{ cron: '*/5 * * * *', rest: '1d' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const settings = yield* settingsOf(ctx);
		const { rows } = (yield* ctx.query({
			appointments: {
				where: {
					status: { eq: 'scheduled' },
					provider: { is_null: false },
					slot: {
						overlaps: {
							start: ctx.now,
							end: DateTime.formatIso(
								DateTime.add(now, { minutes: settings.eta_check_lead_minutes })
							)
						}
					}
				},
				fields: ['slot'],
				limit: 500
			}
		})).appointments;
		yield* Effect.forEach(
			rows.filter((a) => DateTime.isGreaterThanOrEqualTo(DateTime.makeUnsafe(a.slot.start), now)),
			(a) => ctx.schedule('eta_check', { appointment: a.id }, { key: `eta-${a.id}` }),
			{ concurrency: 'unbounded', discard: true }
		);
	}
});
