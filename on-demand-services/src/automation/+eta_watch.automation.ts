import { Effect } from 'effect';
import { Instant } from '@norbital-ai/std/date';
import { automation } from '@norbital-ai/bolt';
import { googleMinutes, settingsOf } from '../lib/dispatch.js';
import { driveMinutes } from '../lib/matching.js';
const MINUTE = 60000;
/** How old a helper's position may be. */
const FRESH_MINUTES = 15;
/**
 * Before every visit, where is its helper? Every five minutes until the visit starts, the drive from the position their
 * app last reported: over the limit, or no fresh position at all, and the visit is flagged for dispatch to call the
 * helper and reassign by hand if need be; back under it, and the flag clears. Dispatch is told once per visit.
 *
 * The drive is Google's, in live traffic, when the straight-line estimate is over half the limit; a helper plainly
 * close is not worth a paid lookup. Without a Google key, or when Google fails, the estimate stands.
 */
const eta_watch = automation({
	description:
		'Until each visit starts, re-estimates the helper’s drive from their last GPS position every five minutes, flagging the visit for dispatch while it exceeds the ETA limit or the position is missing or stale.',
	on: { cron: '*/5 * * * *' },
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 }
});
export default eta_watch;
eta_watch.run(function* (_, ctx) {
	const now = Date.parse(ctx.now);
	const settings = yield* settingsOf(ctx);
	const { rows } = yield* ctx.read('visits', {
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
		select: {
			number: true,
			slot: true,
			location: true,
			attention: true,
			eta_minutes: true,
			helper: { select: { name: true, last_location: true, last_location_at: true } }
		},
		all: true
	});
	const due = rows
		.filter((v) => Date.parse(v.slot.start) >= now)
		.map((v) => {
			const helper = v.helper;
			const fresh =
				helper !== null &&
				helper.last_location !== null &&
				helper.last_location_at !== null &&
				now - Date.parse(helper.last_location_at) <= FRESH_MINUTES * MINUTE;
			return {
				v,
				helper,
				eta: fresh && helper !== null ? driveMinutes(helper.last_location, v.location) : null
			};
		});
	const timed = yield* Effect.forEach(
		due,
		(d) =>
			Effect.gen(function* () {
				const from = d.helper?.last_location ?? null;
				const destination = d.v.location;
				const eta = d.eta;
				if (
					from === null ||
					destination === null ||
					eta === null ||
					eta <= settings.eta_limit_minutes / 2
				)
					return d;
				const live = yield* googleMinutes(ctx, from, [destination], true);
				return { ...d, eta: live?.[0] ?? eta };
			}),
		{ concurrency: 'unbounded' }
	);
	const checked = timed.map(({ v, helper, eta }) => {
		const late = eta === null || eta > settings.eta_limit_minutes;
		// ETA owns only its own warning; dispatch warnings remain in place.
		const attention: typeof v.attention =
			v.attention !== 'none' && v.attention !== 'eta_risk'
				? v.attention
				: late
					? 'eta_risk'
					: 'none';
		return { v, helper, eta, late, attention };
	});
	if (checked.length === 0) return;
	yield* ctx.act(
		'visits.update',
		checked.map(({ v, eta, attention }) => ({
			target: v.id,
			set: { eta_minutes: eta, eta_checked_at: ctx.now, attention }
		}))
	);
	yield* ctx.notify(
		checked
			.filter((c) => c.late)
			.map(({ v, helper, eta }) => ({
				to: { team: 'team-operations' },
				title: `Call ${helper?.name ?? 'the helper'} about ${v.number}`,
				body:
					eta === null
						? 'Their app has not reported a position in the last 15 minutes.'
						: `They are about ${eta} minutes away. Reassign the visit if they cannot make it.`,
				link: { collection: 'visits', id: v.id },
				once: `eta-${v.id}`
			}))
	);
});
