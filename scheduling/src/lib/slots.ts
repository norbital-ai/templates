/**
 * Pure availability helpers shared by the desk booking composer, appointment recovery pane, and
 * portal quote automation. Writes always recheck live state before committing.
 */
import type { Id, Instant, PlainDate } from '@norbital-ai/bolt';
import { DateTime, Duration } from 'effect';
import { epochMs } from './format.js';
import {
	availableSlots,
	BOOKING_AHEAD,
	normalizeSkill,
	occurrences,
	openSlots,
	rank,
	slotOf,
	type Point,
	type Pool,
	type Slot
} from './matching.js';

const dayOf = (from: PlainDate, i: number): PlainDate =>
	DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(from), { days: i }));

/** Days listed in the booking picker and the full recurring horizon the pool must cover. */
export function bookingWindow(
	input: {
		readonly from: PlainDate;
		readonly days: number;
		readonly repeat: string;
		readonly appointments?: number;
	},
	zone: string
) {
	const days = Array.from({ length: input.days }, (_, i) => dayOf(input.from, i));
	const edge = rebookingWindow(input.from, input.days, zone);
	return {
		days,
		from: edge.from,
		to:
			occurrences(edge.to, input.repeat, input.appointments ?? BOOKING_AHEAD, zone).at(-1) ??
			edge.to
	};
}

/**
 * Available start times per day for a new booking, or a structured refusal code/params when nothing
 * can be offered.
 */
export type BookingSlotRefusal =
	| { readonly key: 'errors.customer_service_required' }
	| { readonly key: 'errors.preferred_provider_required' }
	| { readonly key: 'errors.provider_unavailable' }
	| { readonly key: 'errors.provider_lacks_skill'; readonly values: { readonly name: string } };

export function bookingSlots(
	customer: { readonly location: Point | null } | null,
	service: {
		readonly skill: string;
		readonly duration_minutes: number;
		readonly active: boolean;
	} | null,
	input: {
		readonly preference: 'any' | 'preferred';
		readonly providers?: readonly Id<'providers'>[];
		readonly repeat: string;
		readonly appointments?: number;
	},
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
):
	readonly { readonly day: PlainDate; readonly starts: readonly Instant[] }[] | BookingSlotRefusal {
	if (customer === null || service === null || !service.active)
		return { key: 'errors.customer_service_required' };
	const preferred = input.preference === 'preferred' ? (input.providers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		return { key: 'errors.preferred_provider_required' };
	const wantSkill = normalizeSkill(service.skill);
	for (const id of preferred) {
		const p = pool.providers.find((row) => row.id === id);
		if (p === undefined) return { key: 'errors.provider_unavailable' };
		if (!p.skills.some((s) => normalizeSkill(s) === wantSkill))
			return { key: 'errors.provider_lacks_skill', values: { name: p.name } };
	}
	return availableSlots(
		{
			skill: service.skill,
			minutes: service.duration_minutes,
			location: customer.location
		},
		days,
		pool,
		zone,
		now,
		input.repeat,
		input.appointments ?? BOOKING_AHEAD,
		preferred
	);
}

/** Appointment projection used for re-matching and candidate ranking. */
export type Rematch = {
	readonly id: Id<'appointments'>;
	readonly slot: Slot;
	readonly skill: string;
	readonly location: Point | null;
	readonly provider: Id<'providers'> | null;
	readonly unavailable_provider: Id<'providers'> | null;
};

/** Midnight-bounded pool window covering `days` calendar days starting from `from`. */
export function rebookingWindow(from: PlainDate, days: number, zone: string) {
	const midnight = (i: number) =>
		DateTime.formatIso(
			DateTime.makeZonedUnsafe(dayOf(from, i), { timeZone: zone, adjustForTimeZone: true })
		);
	return { from: midnight(0), to: midnight(days - 1) };
}

/** Feasible replacement start times for a scheduled appointment across `days`. */
export function rebookingSlots(
	a: Rematch,
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
) {
	const freed = {
		...pool,
		busy: pool.busy.filter((b) => b.id !== a.id),
		providers: pool.providers.filter((p) => p.id !== a.unavailable_provider)
	};
	const need = {
		skill: a.skill,
		location: a.location,
		minutes: Duration.toMinutes(
			DateTime.distance(DateTime.makeUnsafe(a.slot.start), DateTime.makeUnsafe(a.slot.end))
		)
	};
	const starts = new Map(days.map((d) => [d, new Set<Instant>()]));
	for (const p of freed.providers)
		for (const d of openSlots(p, need, days, freed, zone, now))
			for (const start of d.starts) starts.get(d.day)?.add(start);
	return days.map((day) => ({
		day,
		starts: [...(starts.get(day) ?? [])].sort((a, b) => epochMs(a) - epochMs(b))
	}));
}

/** Qualified providers who can take `a` at `start` (or its current slot), best match first. */
export function candidatesFor(a: Rematch, start: Instant | undefined, pool: Pool, zone: string) {
	const need = {
		skill: a.skill,
		slot: slotOf(
			start ?? a.slot.start,
			Duration.toMinutes(
				DateTime.distance(DateTime.makeUnsafe(a.slot.start), DateTime.makeUnsafe(a.slot.end))
			)
		),
		location: a.location,
		appointment: a.id
	};
	return rank(
		need,
		{
			...pool,
			providers: pool.providers.filter(
				(p) => (start !== undefined || p.id !== a.provider) && p.id !== a.unavailable_provider
			)
		},
		zone
	);
}
