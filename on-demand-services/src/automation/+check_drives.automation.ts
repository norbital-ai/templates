import { automation, type Id } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
import {
	HELD_SHIFT,
	learnLegs,
	loadPool,
	optimise,
	reassign,
	visitsToMove
} from '../lib/dispatch.js';
import {
	cellOf,
	driveMinutes,
	legOf,
	legsOf,
	routes,
	SETTLE_MINUTES,
	DAY,
	MINUTE,
	type Busy,
	type Point
} from '../lib/matching.js';
/** How far ahead the helpers' days are timed and checked: the portal's two weeks. */
const AHEAD_DAYS = 14;
/** Google calls per run, one per origin square. ponytail: a larger backlog drains over the next runs. */
const MAX_CALLS = 25;
/**
 * Keeps every planned drive real. Each leg a helper's next two weeks will be driven (home to the first visit, then visit
 * to visit) that the cache lacks is timed by Google and cached for matching. Then each day is walked in order: a visit
 * its helper can no longer reach from the one before, drive and settling in counted, is handed to the best match.
 * Without a Google key nothing is fetched, and the walk still catches two bookings that raced for one helper. Last, the
 * schedule is brought back to a local optimum (`optimise`): booking places each visit as it arrives, and this undoes the
 * choices later bookings, cancellations and new cleaners made poor. A move schedules this run again (the visits effect), which then finds none.
 */
export default automation('check_drives', {
	description:
		'Times every drive in the helpers’ next two weeks with Google Maps and caches it for matching; a visit its helper can no longer reach in time is reassigned to the best match; then movable visits are rebalanced to a local optimum of workload and driving.',
	// also scheduled by the bookings, visits and helpers effects
	on: { cron: '*/15 * * * *' },
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = Date.parse(ctx.now);
		const pool = yield* loadPool(ctx, ctx.now, new Date(now + AHEAD_DAYS * DAY).toISOString());
		const homes = new Map(pool.helpers.map((h) => [h.id, h.home_location]));
		const days = routes(
			{ ...pool, busy: pool.busy.filter((b) => Date.parse(b.slot.end) > now) },
			ctx.tz
		);
		// the legs not timed yet, by origin square: one call each
		const drive = new Map(pool.drive);
		const todo = new Map<
			string,
			{
				from: Point;
				to: Map<string, Point>;
			}
		>();
		for (const day of days)
			for (const [a, b] of legsOf(day, homes.get(day[0]!.helper) ?? null)) {
				const leg = legOf(a, b);
				if (leg === null || drive.has(leg)) continue;
				const o = todo.get(cellOf(a!)) ?? { from: a!, to: new Map<string, Point>() };
				o.to.set(cellOf(b!), b!);
				todo.set(cellOf(a!), o);
			}
		const learned = yield* learnLegs(
			ctx,
			[...todo.values()]
				.slice(0, MAX_CALLS)
				.map(({ from, to }) => ({ from, to: [...to.values()] })),
			drive
		);
		for (const row of learned) drive.set(row.leg, row.minutes);
		if (learned.length > 0) yield* ctx.act('drive_times.create', learned);
		// walk each day: a visit too close to the last one kept moves, and the next is checked against that one
		const late = new Map<Id<'helpers'>, Id<'visits'>[]>();
		for (const day of days) {
			let last: Busy = day[0]!;
			for (const b of day.slice(1)) {
				const gap = Date.parse(b.slot.start) - Date.parse(last.slot.end);
				const need = (driveMinutes(last.location, b.location, drive) + SETTLE_MINUTES) * MINUTE;
				if (b.planned === true) {
					last = b;
					continue;
				}
				if (gap >= need || Date.parse(b.slot.start) <= now) last = b;
				else late.set(b.helper, [...(late.get(b.helper) ?? []), b.id]);
			}
		}
		// a visit written since it was read is the newer writer's: its conflict is skipped, and that write runs this again
		for (const [helper, ids] of late) {
			const { rows } = (yield* ctx.query(
				visitsToMove({ id: { in: ids }, status: { eq: 'scheduled' }, shift_check: HELD_SHIFT })
			)).visits;
			yield* reassign(ctx, rows, helper).pipe(Effect.catchTag('ActConflict', () => Effect.void));
		}
		yield* optimise(ctx).pipe(Effect.catchTag('ActConflict', () => Effect.void));
	}
});
