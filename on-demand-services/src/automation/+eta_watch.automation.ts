import { DateTime, Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { settingsOf } from '../lib/dispatch.js';
/**
 * Every due visit gets its own read and write scope. A visit changed while Google times its drive cannot make another
 * visit's independent ETA check stale. Queued checks for the same visit coalesce until they run.
 */
export default automation({
	description:
		'Until each visit starts, re-estimates the helper’s drive from their last GPS position every five minutes, flagging the visit for dispatch while it exceeds the ETA limit or the position is missing or stale.',
	on: [{ cron: '*/5 * * * *' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const settings = yield* settingsOf(ctx);
		const { rows } = (yield* ctx.query({
			visits: {
				where: {
					status: { eq: 'scheduled' },
					helper: { is_null: false },
					slot: {
						overlaps: {
							start: ctx.now,
							end: DateTime.formatIso(
								DateTime.add(DateTime.makeUnsafe(ctx.now), {
									minutes: settings.eta_check_lead_minutes
								})
							)
						}
					}
				},
				fields: ['slot']
			}
		})).visits;
		yield* Effect.forEach(
			rows.filter((v) => Date.parse(v.slot.start) >= Date.parse(ctx.now)),
			(v) => ctx.schedule('eta_check', { visit: v.id }, { key: `eta-${v.id}` }),
			{ concurrency: 'unbounded', discard: true }
		);
	}
});
