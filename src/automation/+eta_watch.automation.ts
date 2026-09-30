import { Instant } from '@norbital-ai/std/date';
import { automation } from '@norbital-ai/bolt';
import { googleMinutes, settingsOf } from '../lib/dispatch.js';
import { driveMinutes } from '../lib/matching.js';

const MINUTE = 60_000;
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

eta_watch.run(async (_, ctx) => {
	const now = Date.parse(ctx.now);
	const settings = await settingsOf(ctx);
	const { rows } = await ctx.read('visits', {
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
			const h = v.helper!;
			const fresh =
				h.last_location !== null &&
				h.last_location_at !== null &&
				now - Date.parse(h.last_location_at) <= FRESH_MINUTES * MINUTE;
			return { v, eta: fresh ? driveMinutes(h.last_location, v.location) : null };
		});
	await Promise.all(
		due.map(async (d) => {
			const from = d.v.helper!.last_location;
			if (d.eta === null || d.eta <= settings.eta_limit_minutes / 2 || d.v.location === null)
				return;
			const live = await googleMinutes(ctx, from!, [d.v.location], true);
			d.eta = live?.[0] ?? d.eta;
		})
	);
	const checked = due.map(({ v, eta }) => {
		const late = eta === null || eta > settings.eta_limit_minutes;
		// another reason for attention (a missing helper, a proposal) is dispatch's, and stays
		const attention: typeof v.attention = late
			? 'eta_risk'
			: v.attention === 'eta_risk'
				? 'none'
				: v.attention;
		return { v, eta, late, attention };
	});
	if (checked.length === 0) return;
	await ctx.act(
		'visits.update',
		checked.map(({ v, eta, attention }) => ({
			target: v.id,
			set: { eta_minutes: eta, eta_checked_at: ctx.now, attention }
		}))
	);
	await ctx.notify(
		checked
			.filter((c) => c.late)
			.map(({ v, eta }) => ({
				to: { team: 'Operations' },
				title: `Call ${v.helper!.name} about ${v.number}`,
				body:
					eta === null
						? 'Their app has not reported a position in the last 15 minutes.'
						: `They are about ${eta} minutes away. Reassign the visit if they cannot make it.`,
				link: { collection: 'visits', id: v.id },
				once: `eta-${v.id}`
			}))
	);
});
