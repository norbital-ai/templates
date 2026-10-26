import { Effect } from 'effect';
import { Instant } from '@norbital-ai/std/date';
import { automation } from '@norbital-ai/bolt';
import { settingsOf } from '../lib/dispatch.js';
const MINUTE = 60000;
/**
 * Every due visit gets its own read and write scope. A visit changed while Google times its drive cannot make another
 * visit's independent ETA check stale. Queued checks for the same visit coalesce until they run.
 */
export default automation('eta_watch', {
	description:
		'Until each visit starts, re-estimates the helper’s drive from their last GPS position every five minutes, flagging the visit for dispatch while it exceeds the ETA limit or the position is missing or stale.',
	on: { cron: '*/5 * * * *' },
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = Date.parse(ctx.now);
		const settings = yield* settingsOf(ctx);
		const { rows } = yield* ctx.query('visits', {
			where: {
				status: { eq: 'scheduled' },
				helper: { isNull: false },
				slot: {
					overlaps: {
						start: ctx.now,
						end: Instant(new Date(now + settings.eta_check_lead_minutes * MINUTE).toISOString())
					}
				}
			},
			select: { slot: true },
			all: true
		});
		yield* Effect.forEach(
			rows.filter((v) => Date.parse(v.slot.start) >= now),
			(v) => ctx.schedule('eta_check', { visit: v.id }, { key: `eta-${v.id}` }),
			{ concurrency: 'unbounded', discard: true }
		);
	}
});
