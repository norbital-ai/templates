/**
 * What used to be the `open_slots`, `rebooking_slots` and `candidates` reads: pure functions over a pool (`dispatch.ts`
 * `poolRequest` + `driveRequest`, read by the page with its `ctx.query` or by server code with `loadPool`). The writes
 * that act on a pick (`bookings_book`, `visits_rebook`, `visits_reassign`) recheck everything, so a preview is safe.
 */
import type { Id, Instant, PlainDate } from '@norbital-ai/bolt';
import { DateTime, Duration } from 'effect';
import {
	availableSlots,
	BOOKING_AHEAD,
	occurrences,
	openSlots,
	rank,
	slotOf,
	type Point,
	type Pool
} from './matching.js';
/** The days a booking picker lists and the full recurring horizon its pool must cover. */
export function bookingWindow(
	input: {
		readonly from: PlainDate;
		readonly days: number;
		readonly repeat: string;
		readonly visits?: number;
	},
	zone: string
) {
	const days = Array.from({ length: input.days }, (_, i) =>
		DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(input.from), { days: i }))
	);
	const last = DateTime.formatIso(
		DateTime.makeZonedUnsafe(days.at(-1)!, { timeZone: zone, adjustForTimeZone: true })
	);
	return {
		days,
		from: DateTime.formatIso(
			DateTime.makeZonedUnsafe(days[0]!, { timeZone: zone, adjustForTimeZone: true })
		),
		to: occurrences(last, input.repeat, input.visits ?? BOOKING_AHEAD, zone).at(-1)!
	};
}
/**
 * The starts per day a new booking could take: skills, preference, travel and the full recurring horizon checked. A
 * string is why nothing can be offered.
 */
export function bookingSlots(
	customer: { readonly location: Point | null; readonly area: string | null } | null,
	service: {
		readonly skill: string;
		readonly duration_minutes: number;
		readonly active: boolean;
	} | null,
	input: {
		readonly preference: 'any' | 'preferred';
		readonly helpers?: readonly Id<'helpers'>[];
		readonly repeat: string;
		readonly visits?: number;
	},
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
) {
	if (customer === null || service === null || !service.active)
		return 'Pick a customer and an active service.';
	const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		return 'Name at least one preferred helper.';
	for (const id of preferred) {
		const h = pool.helpers.find((h) => h.id === id);
		if (h === undefined) return 'The selected helper is not available.';
		if (!h.skills.includes(service.skill)) return `${h.name} cannot perform the selected service.`;
	}
	return availableSlots(
		{
			skill: service.skill,
			minutes: service.duration_minutes,
			location: customer.location,
			area: customer.area
		},
		days,
		pool,
		zone,
		now,
		input.repeat,
		input.visits ?? BOOKING_AHEAD,
		preferred
	);
}
/** What a re-match reads of the visit it moves. */
export type Rematch = {
	readonly id: Id<'visits'>;
	readonly slot: { readonly start: Instant; readonly end: Instant | null };
	readonly skill: string;
	readonly location: Point | null;
	readonly area: string | null;
	readonly helper: Id<'helpers'> | null;
	readonly unavailable_helper: Id<'helpers'> | null;
};
/** The pool window of `rebookingSlots`: midnight of the first and of the last day. */
export function rebookingWindow(days: readonly PlainDate[], zone: string) {
	return {
		from: DateTime.formatIso(
			DateTime.makeZonedUnsafe(days[0]!, { timeZone: zone, adjustForTimeZone: true })
		),
		to: DateTime.formatIso(
			DateTime.makeZonedUnsafe(days.at(-1)!, { timeZone: zone, adjustForTimeZone: true })
		)
	};
}
/** Feasible replacement starts for a scheduled visit on each of `days`, adjacent travel included. */
export function rebookingSlots(
	v: Rematch,
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
) {
	const freed = {
		...pool,
		busy: pool.busy.filter((b) => b.id !== v.id),
		helpers: pool.helpers.filter((h) => h.id !== v.unavailable_helper)
	};
	const need = {
		skill: v.skill,
		location: v.location,
		area: v.area,
		minutes: Duration.toMinutes(
			DateTime.distance(DateTime.makeUnsafe(v.slot.start), DateTime.makeUnsafe(v.slot.end!))
		)
	};
	const starts = new Map(days.map((d) => [d, new Set<Instant>()]));
	for (const h of freed.helpers)
		for (const d of openSlots(h, need, days, freed, zone, now))
			for (const start of d.starts) starts.get(d.day)!.add(start);
	return days.map((day) => ({ day, starts: [...starts.get(day)!].sort() }));
}
/**
 * The helpers who could take the visit instead (at `start`, else its own time), best match first; at its own time its
 * current helper is not one of them, and the helper who reported unavailable never is. Read the pool at `start ?? slot.start`.
 */
export function candidatesFor(v: Rematch, start: Instant | undefined, pool: Pool, zone: string) {
	const need = {
		skill: v.skill,
		slot: slotOf(
			start ?? v.slot.start,
			Duration.toMinutes(
				DateTime.distance(DateTime.makeUnsafe(v.slot.start), DateTime.makeUnsafe(v.slot.end!))
			)
		),
		location: v.location,
		area: v.area,
		visit: v.id
	};
	return rank(
		need,
		{
			...pool,
			helpers: pool.helpers.filter(
				(h) => (start !== undefined || h.id !== v.helper) && h.id !== v.unavailable_helper
			)
		},
		zone
	);
}
