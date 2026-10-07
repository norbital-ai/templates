/**
 * One shift pattern's cycle: which shift definition each day of it names, and therefore which dates a person is
 * rostered to work. Day 1 is the day the pattern's effective range opens, so a date's place in the cycle is fixed
 * and a cycle of any length repeats — a 4-day two-on-two-off as well as a 7-day week.
 */
import { Schema } from 'effect';

const CycleDay = Schema.Struct({
	roster_code_id: Schema.optional(Schema.NullOr(Schema.String))
});
/** One cycle day as stored: the shift definition it names, absent when the day is unassigned. */
export type CycleDay = Schema.Schema.Type<typeof CycleDay>;

const PatternDays = Schema.Struct({ days: Schema.Array(CycleDay) });

/** The stored `pattern.days` list, or an empty list when the field holds anything else. */
export const cycleDays = (value: unknown): readonly CycleDay[] =>
	Schema.is(PatternDays)(value) ? value.days : [];

/** Whole days between two calendar dates, both inclusive. */
const spanDays = (from: string, to: string): number =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** The cycle day a date falls on, or null when there is no cycle to place it in. */
export const cycleDayOn = (
	days: readonly CycleDay[],
	anchor: string,
	date: string
): CycleDay | null => {
	const first = days[0];
	if (first === undefined || date < anchor) return null;
	// spanDays counts both ends, so the anchor itself is day one.
	const offset = spanDays(anchor, date) - 1;
	return days[offset % days.length] ?? null;
};

const Variant = Schema.Struct({
	day_type: Schema.optional(Schema.String),
	start_time: Schema.optional(Schema.String),
	end_time: Schema.optional(Schema.String),
	break_minutes: Schema.optional(Schema.Number)
});
const CLOCK = /^\d{2}:\d{2}$/;
const clockMinutes = (clock: string): number =>
	Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** One shift definition as a day reads it: its code, its day type and its scheduled hours net of the break. */
export type PlannedShift = {
	readonly code: string;
	readonly day_type: string;
	readonly scheduled_hours: number;
};

/** A stored shift definition as a planned day; a shift ending at or before its start runs past midnight. */
export const plannedShift = (row: {
	readonly code?: string | null;
	readonly variant?: unknown;
}): PlannedShift => {
	const variant = Schema.is(Variant)(row.variant) ? row.variant : {};
	const { start_time: start, end_time: end } = variant;
	let minutes = 0;
	if (start != null && end != null && CLOCK.test(start) && CLOCK.test(end)) {
		minutes = clockMinutes(end) - clockMinutes(start);
		if (minutes <= 0) minutes += 1440;
		minutes = Math.max(0, minutes - (variant.break_minutes ?? 0));
	}
	return {
		code: row.code ?? '',
		day_type: variant.day_type ?? '',
		scheduled_hours: Math.round((minutes / 60) * 100) / 100
	};
};

/**
 * The shift definition planned for one date: the roster entry's own, else the cycle day of the pattern its terms
 * name, anchored at the pattern's effective start; null when neither names one.
 */
export const plannedShiftId = (input: {
	readonly date: string;
	readonly rostered?: string | null;
	readonly pattern?: { readonly pattern?: unknown; readonly anchor?: string | null } | null;
}): string | null => {
	if (input.rostered != null && input.rostered !== '') return input.rostered;
	const anchor = input.pattern?.anchor;
	if (input.pattern == null || anchor == null) return null;
	const id = cycleDayOn(cycleDays(input.pattern.pattern), anchor, input.date)?.roster_code_id;
	return id == null || id === '' ? null : id;
};
