import { add_days } from '@norbital-ai/std/date';
import type { JsonObject } from './contracts.js';
import { objectValue, valueText } from './reads.js';

// a formatter is the costly part of a roster day, and a run prices thousands of them in one zone
const formats = new Map<string, Intl.DateTimeFormat>();
const formatIn = (zone: string): Intl.DateTimeFormat => {
	const held = formats.get(zone);
	if (held !== undefined) return held;
	const format = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	});
	formats.set(zone, format);
	return format;
};

/** `date` + clock time in an IANA zone, as epoch milliseconds. */
// everyone on one shift shares its instants: a run works each out once
const instants = new Map<string, number>();
const instant = (date: string, time: string, zone: string): number => {
	const key = `${zone} ${date} ${time}`;
	const held = instants.get(key);
	if (held !== undefined) return held;
	const guess = Date.parse(`${date}T${time}:00Z`);
	const shown = formatIn(zone)
		.formatToParts(new Date(guess))
		.filter((part) => part.type !== 'literal')
		.map((part) => part.value);
	const [year, month, day, hour, minute, second] = shown;
	const found = guess - (Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second!) - guess);
	if (instants.size >= 20_000) instants.clear();
	instants.set(key, found);
	return found;
};

/** The planned shift for one roster day, or an untimed/non-work day. */
export function scheduled(
	row: JsonObject,
	data: { readonly zone: string; readonly shift?: JsonObject }
): {
	readonly spans: readonly { readonly start: number; readonly end: number }[];
	readonly day_type: 'WORK' | 'REST' | 'OFF' | 'ABS';
	readonly untimed: number;
} {
	const variant = data.shift === undefined ? null : objectValue(data.shift.variant);
	const dayType = row.day_type ?? variant?.day_type;
	const day_type: 'WORK' | 'REST' | 'OFF' | 'ABS' =
		dayType === 'REST' || dayType === 'OFF' || dayType === 'ABS' ? dayType : 'WORK';
	if (day_type !== 'WORK') return { spans: [], day_type, untimed: 0 };
	const untimed = typeof variant?.untimed_hours === 'number' ? variant.untimed_hours : 0;
	if (variant == null || variant.start_time == null || variant.end_time == null)
		return { spans: [], day_type, untimed };
	const date = valueText(row, 'work_date');
	const endDate = variant.ends_next_day === true ? String(add_days(date, 1)) : date;
	const start = instant(date, String(variant.start_time), data.zone);
	const end = instant(endDate, String(variant.end_time), data.zone);
	const pauses = (Array.isArray(variant.breaks) ? variant.breaks : [])
		.map(objectValue)
		.filter((pause) => pause.paid !== true)
		.map((pause) => {
			const day = String(pause.start_time) < String(variant.start_time) ? endDate : date;
			return {
				start: instant(day, String(pause.start_time), data.zone),
				end: instant(day, String(pause.end_time), data.zone)
			};
		})
		.toSorted((a, b) => a.start - b.start);
	const spans: { start: number; end: number }[] = [];
	let from = start;
	for (const pause of pauses) {
		if (pause.start > from) spans.push({ start: from, end: pause.start });
		from = Math.max(from, pause.end);
	}
	if (end > from) spans.push({ start: from, end });
	return { spans, day_type, untimed };
}

interface Span {
	readonly start: number;
	readonly end: number;
}

const AWARD_STEP_MINUTES = 30;

/** Where two sets of spans overlap. */
export const overlapSpans = (a: readonly Span[], b: readonly Span[]): readonly Span[] =>
	a.flatMap((left) =>
		b.flatMap((right) => {
			const start = Math.max(left.start, right.start);
			const end = Math.min(left.end, right.end);
			return end > start ? [{ start, end }] : [];
		})
	);

export const spanMinutes = (spans: readonly Span[]): number =>
	spans.reduce((total, span) => total + (span.end - span.start) / 60_000, 0);

/**
 * What the clock awards of planned overtime: all of it once the clock covers `fullPercent` of the
 * plan, otherwise the covered time rounded down to the half hour. A clock-out at 17:59 pays until
 * 17:30, and time outside the plan never counts.
 */
export function awardedMinutes(
	planned: readonly Span[],
	clock: readonly Span[],
	fullPercent: number
): number {
	const total = spanMinutes(planned);
	const covered = spanMinutes(overlapSpans(planned, clock));
	if (covered > 0 && covered * 100 >= total * fullPercent) return total;
	return Math.floor(covered / AWARD_STEP_MINUTES) * AWARD_STEP_MINUTES;
}

/** The published holidays observed on a day. */
export function holidaysForDay(
	day: string,
	data: {
		readonly holidays: readonly JsonObject[];
		readonly roster_day_types?: Readonly<Record<string, string>>;
		readonly roster_days: readonly JsonObject[];
		/** Whose day it is: a holiday naming a person is theirs alone. */
		readonly employee?: string | undefined;
	}
): readonly JsonObject[] {
	return data.holidays.filter(
		(holiday) =>
			holiday.date === day &&
			holiday.published_at != null &&
			(holiday.employee_id == null || String(holiday.employee_id) === data.employee) &&
			(holiday.given_to !== 'ONLY_IF_OFF_ON_REPLACED_DATE' ||
				data.roster_day_types?.[String(holiday.replaces)] !== 'WORK')
	);
}
