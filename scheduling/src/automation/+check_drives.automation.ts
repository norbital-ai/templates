import { automation, type Id } from '@norbital-ai/bolt';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import {
	appointmentsToMove,
	HELD_SHIFT,
	learnLegs,
	loadPool,
	optimise,
	reassign,
	settingsOf
} from '../lib/dispatch.js';
import {
	cellOf,
	driveMinutes,
	legOf,
	legsOf,
	routes,
	type Busy,
	type Point
} from '../lib/matching.js';

/** Maximum uncached Google Routes calls per sweep (one per origin grid square). */
const MAX_CALLS = 25;

/**
 * Caches Google Routes drive times for upcoming provider routes, reassigns any appointment that
 * became unreachable under real travel times, and runs relocate local search to keep the schedule
 * balanced.
 */
export default automation({
	description:
		'Caches Google Routes drive times for upcoming routes, reassigns unreachable appointments, and rebalances movable appointments.',
	on: [{ cron: '8,23,38,53 * * * *', rest: '1d' }],
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const { booking_horizon_days, buffer_minutes } = yield* settingsOf(ctx);
		const pool = yield* loadPool(
			ctx,
			ctx.now,
			DateTime.formatIso(DateTime.add(now, { days: booking_horizon_days }))
		);
		const homes = new Map(pool.providers.map((p) => [p.id, p.home_location]));
		const days = routes(
			{
				...pool,
				busy: pool.busy.filter((b) => DateTime.isGreaterThan(DateTime.makeUnsafe(b.slot.end), now))
			},
			ctx.tz
		);
		const drive = new Map(pool.drive);
		const todo = new Map<string, { from: Point; to: Map<string, Point> }>();
		for (const day of days)
			for (const [a, b] of legsOf(day, homes.get(day[0].provider) ?? null)) {
				if (a === null || b === null) continue;
				const leg = legOf(a, b);
				if (leg === null || drive.has(leg)) continue;
				const o = todo.get(cellOf(a)) ?? { from: a, to: new Map<string, Point>() };
				o.to.set(cellOf(b), b);
				todo.set(cellOf(a), o);
			}
		const learned = yield* learnLegs(
			ctx,
			[...todo.values()]
				.slice(0, MAX_CALLS)
				.map(({ from, to }) => ({ from, to: [...to.values()] })),
			drive
		);
		for (const row of learned) drive.set(row.leg, row.minutes);
		if (learned.length > 0)
			yield* ctx
				.act(
					{ 'drive_times.create': learned },
					{
						key: `drives:${learned
							.map((row) => row.leg)
							.sort()
							.join('|')}`
					}
				)
				.pipe(Effect.catchTags({ ActConflict: () => Effect.void, ActRefused: () => Effect.void }));
		const late = new Map<Id<'providers'>, Id<'appointments'>[]>();
		for (const day of days) {
			const [first, ...rest] = day;
			let last: Busy = first;
			for (const b of rest) {
				const start = DateTime.makeUnsafe(b.slot.start);
				const reachable = DateTime.isGreaterThanOrEqualTo(
					start,
					DateTime.add(DateTime.makeUnsafe(last.slot.end), {
						minutes: driveMinutes(last.location, b.location, drive) + buffer_minutes
					})
				);
				if (b.planned === true) {
					last = b;
					continue;
				}
				if (reachable || DateTime.isLessThanOrEqualTo(start, now)) last = b;
				else late.set(b.provider, [...(late.get(b.provider) ?? []), b.id]);
			}
		}
		if (late.size > 0) {
			for (const [provider, ids] of late) {
				const { rows } = (yield* ctx.query(
					appointmentsToMove({
						id: { in: ids },
						status: { eq: 'scheduled' },
						shift_check: HELD_SHIFT
					})
				)).appointments;
				yield* reassign(ctx, rows, provider).pipe(
					Effect.catchTag('ActConflict', () => Effect.void)
				);
			}
			return;
		}
		yield* optimise(ctx, { ...pool, drive }).pipe(
			Effect.catchTag('ActConflict', () => Effect.void)
		);
	}
});
