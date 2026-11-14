import { DateTime, Duration } from 'effect';
import type { JsonObject } from './contracts.js';
import { isWorkingDay, offDaysFor } from './engine.js';
import { isJsonObject } from './foundation.js';
import { objectValue, valueText } from './reads.js';
import { dateWeekday } from './time_evidence.js';

/** `date` + clock time in an IANA zone, as epoch milliseconds. */
// everyone on one shift shares its instants: a run works each out once
const instants = new Map<string, number>();
const instant = (date: string, time: string, zone: string): number => {
	const key = `${zone} ${date} ${time}`;
	const held = instants.get(key);
	if (held !== undefined) return held;
	const found = DateTime.toEpochMillis(
		DateTime.makeZonedUnsafe(`${date}T${time}:00`, { timeZone: zone, adjustForTimeZone: true })
	);
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
	const endDate =
		variant.ends_next_day === true
			? DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(date), { days: 1 }))
			: date;
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
	spans.reduce(
		(total, span) => total + Duration.toMinutes(Duration.millis(span.end - span.start)),
		0
	);

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

const WEEKDAYS = [
	'SUNDAY',
	'MONDAY',
	'TUESDAY',
	'WEDNESDAY',
	'THURSDAY',
	'FRIDAY',
	'SATURDAY'
] as const;
/** What says how a stint's days are planned: the pay group's schedule as its employer, and the company's shifts and patterns by id. */
export type Plan = {
	readonly employer: JsonObject;
	readonly shifts: ReadonlyMap<unknown, JsonObject>;
	readonly patterns: ReadonlyMap<unknown, JsonObject>;
};
/** A contract's planned day with no roster entry: its pattern's day, else its ordinary week (undefined: no shift). */
export const plannedWork = (terms: JsonObject, date: string, plan: Plan): boolean | undefined => {
	const pattern = plan.patterns.get(terms.shift_pattern_id);
	if (pattern === undefined) return isWorkingDay(date, offDaysFor(terms, plan.employer));
	const cycle = objectValue(pattern.pattern);
	const weekly = isJsonObject(cycle.days) ? cycle.days : null;
	const rotation = Array.isArray(cycle.cycle) ? cycle.cycle : null;
	const from = String(objectValue(pattern.effective_range).from ?? '');
	let shiftId: string | null = null;
	if (weekly !== null) {
		const weekday = WEEKDAYS[dateWeekday(date)] ?? 'SUNDAY';
		shiftId = String(weekly[weekday] ?? '');
	} else if (rotation !== null && rotation.length > 0 && from !== '') {
		const span = Duration.toDays(
			DateTime.distance(DateTime.makeUnsafe(from), DateTime.makeUnsafe(date))
		);
		shiftId = String(
			objectValue(rotation[((span % rotation.length) + rotation.length) % rotation.length])
				.shift_definition_id
		);
	}
	const shift = shiftId == null ? undefined : plan.shifts.get(shiftId);
	return shift === undefined ? undefined : objectValue(shift.variant).day_type === 'WORK';
};
/** One person's days as leave reads them: the terms and employer in force on a day, their roster rows by date and their company's holidays. */
export type LeaveDays = Omit<Plan, 'employer'> & {
	readonly terms: (date: string) => JsonObject;
	readonly employer: (date: string) => JsonObject;
	readonly roster: ReadonlyMap<string, JsonObject>;
	readonly holidays: readonly JsonObject[];
	readonly employee: string;
};
/**
 * Why no leave falls on a day: the person does not work it (`REST`: the roster's day, else the pattern's or the ordinary
 * week's, exactly as a run plans it) or it is a holiday of theirs (`HOLIDAY`). A day no plan answers for is left open.
 */
export const leaveOffDay = (date: string, own: LeaveDays): 'REST' | 'HOLIDAY' | undefined => {
	const works = (day: string) => {
		const shift = own.shifts.get(own.roster.get(day)?.shift_definition_id);
		return shift === undefined
			? plannedWork(own.terms(day), day, { ...own, employer: own.employer(day) })
			: objectValue(shift.variant).day_type === 'WORK';
	};
	const replaced = Object.fromEntries(
		own.holidays.flatMap((row) =>
			typeof row.replaces === 'string' && works(row.replaces) === true
				? [[row.replaces, 'WORK'] as const]
				: []
		)
	);
	if (
		holidaysForDay(date, {
			holidays: own.holidays,
			roster_day_types: replaced,
			roster_days: [],
			employee: own.employee
		}).length > 0
	)
		return 'HOLIDAY';
	return works(date) === false ? 'REST' : undefined;
};
