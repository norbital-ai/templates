import { automation, type Id } from '@norbital-ai/bolt';
import { googleMinutes, loadPool, reassign, VISIT } from '../lib/dispatch.js';
import {
	cellOf,
	driveMinutes,
	legOf,
	legsOf,
	routes,
	SETTLE_MINUTES,
	type Busy,
	type Point
} from '../lib/matching.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** How far ahead the helpers' days are timed and checked: the portal's two weeks. */
const AHEAD_DAYS = 14;
/** Google calls per run, one per origin square. ponytail: a larger backlog drains over the next runs. */
const MAX_CALLS = 25;

/**
 * Keeps every planned drive real. Each leg a helper's next two weeks will be driven (home to the first visit, then visit
 * to visit) that the cache lacks is timed by Google and cached for matching. Then each day is walked in order: a visit
 * its helper can no longer reach from the one before, drive and settling in counted, is handed to the best match.
 * Without a Google key nothing is fetched, and the walk still catches two bookings that raced for one helper.
 */
const check_drives = automation({
	description:
		'Times every drive in the helpers’ next two weeks with Google Maps and caches it for matching; a visit its helper can no longer reach in time is reassigned to the best match.',
	on: [
		{ cron: '*/15 * * * *' },
		{ created: 'bookings' },
		{ updated: 'visits', fields: ['helper', 'slot', 'status'] },
		{ updated: 'helpers', fields: ['home_location'] }
	],
	runAs: ['dispatch_automation'],
	concurrency: { max: 1 }
});
export default check_drives;

check_drives.run(async (_, ctx) => {
	const now = Date.parse(ctx.now);
	const pool = await loadPool(ctx, ctx.now, new Date(now + AHEAD_DAYS * DAY).toISOString());
	const homes = new Map(pool.helpers.map((h) => [h.id, h.home_location]));
	const days = routes(
		{ ...pool, busy: pool.busy.filter((b) => Date.parse(b.slot.end) > now) },
		ctx.tz
	);

	// the legs not timed yet, by origin square: one call each
	const drive = new Map(pool.drive);
	const todo = new Map<string, { from: Point; to: Map<string, Point> }>();
	for (const day of days)
		for (const [a, b] of legsOf(day, homes.get(day[0]!.helper) ?? null)) {
			const leg = legOf(a, b);
			if (leg === null || drive.has(leg)) continue;
			const o = todo.get(cellOf(a!)) ?? { from: a!, to: new Map<string, Point>() };
			o.to.set(cellOf(b!), b!);
			todo.set(cellOf(a!), o);
		}
	const learned: { leg: string; minutes: number }[] = [];
	for (const { from, to } of [...todo.values()].slice(0, MAX_CALLS)) {
		const dests = [...to.values()];
		const minutes = await googleMinutes(ctx, from, dests, false);
		if (minutes === null) break; // no key, or Google refused: the estimates stand
		dests.forEach((d, i) => {
			const m = minutes[i];
			if (m == null) return;
			learned.push({ leg: legOf(from, d)!, minutes: m });
			drive.set(legOf(from, d)!, m);
		});
	}
	if (learned.length > 0) await ctx.act('drive_times.create', learned);

	// walk each day: a visit too close to the last one kept moves, and the next is checked against that one
	const late = new Map<string, Id<'visits'>[]>();
	for (const day of days) {
		let last: Busy = day[0]!;
		for (const b of day.slice(1)) {
			const gap = Date.parse(b.slot.start) - Date.parse(last.slot.end);
			const need = (driveMinutes(last.location, b.location, drive) + SETTLE_MINUTES) * MINUTE;
			if (gap >= need || Date.parse(b.slot.start) <= now) last = b;
			else late.set(b.helper, [...(late.get(b.helper) ?? []), b.id as Id<'visits'>]);
		}
	}
	for (const [helper, ids] of late) {
		const { rows } = await ctx.read('visits', {
			where: { id: { in: ids }, status: { eq: 'scheduled' } },
			select: VISIT,
			all: true
		});
		await reassign(ctx, rows, helper);
	}
});
