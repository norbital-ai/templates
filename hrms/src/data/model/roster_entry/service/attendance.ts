import { DateTime, Duration } from 'effect';
import type { JsonObject } from '../../../../lib/contracts.js';
import { isWorkingDay, offDaysFor } from '../../payroll_run/service/engine.js';
import { addDays, isJsonObject } from '../../../../lib/foundation.js';
import { objectValue, valueText } from '../../../../lib/reads.js';
import { dateWeekday, intervalSpans } from './time_evidence.js';

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
	const endDate = variant.ends_next_day === true ? addDays(date, 1) : date;
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
 * What the clock awards of planned overtime: the planned minutes the clock covers, to the minute. A clock-out at 17:59
 * pays until 17:59; time outside the plan never counts. The law pays overtime worked, with no rounding unit.
 */
export const awardedMinutes = (planned: readonly Span[], clock: readonly Span[]): number =>
	spanMinutes(overlapSpans(planned, clock));

/**
 * The shift spans a worker is expected to work on a day, accounting for half-day or full-day leave.
 * On a standard two-part shift separated by one unpaid break, AM leave covers the first part and PM leave covers the
 * second; otherwise half-day leave splits the shift's net work duration in half.
 */
export const expectedShiftSpans = (
	spans: readonly Span[],
	amLeave: boolean,
	pmLeave: boolean
): readonly Span[] => {
	if (amLeave && pmLeave) return [];
	if (!amLeave && !pmLeave) return spans;
	if (spans.length === 2 && spans[0] !== undefined && spans[1] !== undefined)
		return pmLeave ? [spans[0]] : [spans[1]];
	const totalMs = spans.reduce((total, span) => total + (span.end - span.start), 0);
	if (totalMs <= 0) return [];
	const halfMs = totalMs / 2;
	const out: Span[] = [];
	let seen = 0;
	for (const span of spans) {
		const len = span.end - span.start;
		if (pmLeave) {
			if (seen >= halfMs) break;
			const take = Math.min(len, halfMs - seen);
			if (take > 0) out.push({ start: span.start, end: span.start + take });
		} else if (seen + len > halfMs) {
			const skip = Math.max(0, halfMs - seen);
			out.push({ start: span.start + skip, end: span.end });
		}
		seen += len;
	}
	return out;
};

/** Index published holidays by `date` once per run so day lookups stay O(1). */
export function indexHolidays(
	holidays: readonly JsonObject[]
): ReadonlyMap<string, readonly JsonObject[]> {
	const byDate = new Map<string, JsonObject[]>();
	for (const holiday of holidays) {
		if (holiday.published_at == null || typeof holiday.date !== 'string') continue;
		const bucket = byDate.get(holiday.date);
		if (bucket === undefined) byDate.set(holiday.date, [holiday]);
		else bucket.push(holiday);
	}
	return byDate;
}

/** The published holidays observed on a day. */
export function holidaysForDay(
	day: string,
	data: {
		readonly holidays: readonly JsonObject[];
		readonly holidays_by_date?: ReadonlyMap<string, readonly JsonObject[]>;
		readonly roster_day_types?: Readonly<Record<string, string>>;
		readonly roster_days: readonly JsonObject[];
		/** Whose day it is: a holiday naming a person is theirs alone. */
		readonly employee?: string | undefined;
	}
): readonly JsonObject[] {
	const candidates =
		data.holidays_by_date !== undefined ? (data.holidays_by_date.get(day) ?? []) : data.holidays;
	return candidates.filter(
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
	// a weekly pattern needs no first day; a rotation with none has no day to count from
	const from = isJsonObject(pattern.effective_range)
		? String(pattern.effective_range.from ?? '')
		: '';
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

export const closedSpans = (value: unknown) =>
	intervalSpans(
		Array.isArray(value) ? value.filter((row) => isJsonObject(row) && row.end != null) : []
	);

export const scheduledHours = ({ spans, untimed }: ReturnType<typeof scheduled>): number =>
	spans.reduce(
		(total, span) => total + Duration.toHours(Duration.millis(span.end - span.start)),
		untimed
	);

/**
 * Builds normalized work days, roster day types (including replaced-holiday fallback), holiday index, and holiday names
 * from roster rows. Shared by payroll calculation and the overtime report so both evaluate attendance identically.
 */
export function buildWorkDays(input: {
	readonly workRows: readonly JsonObject[];
	readonly ownerOf: (row: JsonObject) => string;
	readonly stintOf: (stretch: string) => string;
	readonly employeeOf: ReadonlyMap<string, string>;
	readonly answeringByStretch: ReadonlyMap<string, JsonObject>;
	readonly versionOn: (employeeId: string, date: string) => JsonObject | undefined;
	readonly termsOf: ReadonlyMap<string, JsonObject>;
	readonly holidays: readonly JsonObject[];
	readonly leaves: readonly JsonObject[];
	readonly shifts: ReadonlyMap<unknown, JsonObject>;
	readonly patterns: ReadonlyMap<unknown, JsonObject>;
	readonly employer: JsonObject;
	readonly zone: string;
}) {
	const plan: Plan = { employer: input.employer, shifts: input.shifts, patterns: input.patterns };
	const planned = (terms: JsonObject, date: string) => plannedWork(terms, date, plan);
	const planOf = (row: JsonObject) => {
		const shift = input.shifts.get(row.shift_definition_id);
		return scheduled(row, { zone: input.zone, ...(shift === undefined ? {} : { shift }) });
	};
	const rosterDayTypes = new Map<string, Record<string, string>>();
	for (const row of input.workRows) {
		const owner = input.ownerOf(row);
		const days = rosterDayTypes.get(owner) ?? {};
		days[String(row.work_date)] = planOf(row).day_type;
		rosterDayTypes.set(owner, days);
	}
	// a holiday given only to those off on the date it replaces reads that date's plan, rostered or not
	const replaced = [
		...new Set(
			input.holidays.flatMap((row) => (typeof row.replaces === 'string' ? [row.replaces] : []))
		)
	];
	for (const [owner, days] of rosterDayTypes) {
		const own = input.answeringByStretch.get(owner);
		if (own === undefined) continue;
		const employeeId = String(own.employee_id);
		for (const date of replaced) {
			if (days[date] !== undefined) continue;
			const row = input.versionOn(employeeId, date) ?? own;
			const work = planned(objectValue(row.terms), date);
			if (work !== undefined) days[date] = work ? 'WORK' : 'OFF';
		}
	}
	const leaveDays = new Set<string>();
	const leavePartsByDay = new Map<string, Set<string>>();
	for (const entry of input.leaves) {
		if (entry.encashment === true) continue;
		const person = input.employeeOf.get(String(entry.employment_id));
		for (const child of Array.isArray(entry.leave_catalog_entry_day)
			? entry.leave_catalog_entry_day
			: [])
			if (isJsonObject(child) && typeof child.incurred_on === 'string') {
				const key = `${person}:${child.incurred_on}`;
				leaveDays.add(key);
				const parts = leavePartsByDay.get(key) ?? new Set<string>();
				parts.add(String(child.part));
				leavePartsByDay.set(key, parts);
			}
	}
	const holidaysByDate = indexHolidays(input.holidays);
	const workDays = new Map<string, JsonObject[]>();
	const holidayNamesByEmployee = new Map<string, Map<string, string>>();
	for (const row of input.workRows) {
		const owner = input.ownerOf(row);
		const employeeId = input.employeeOf.get(input.stintOf(owner));
		const days = workDays.get(owner) ?? [];
		const date = String(row.work_date);
		const holidays = holidaysForDay(date, {
			holidays: input.holidays,
			holidays_by_date: holidaysByDate,
			roster_day_types: rosterDayTypes.get(owner) ?? {},
			roster_days: [],
			employee: employeeId
		});
		// a makeup workday never masks the holiday it makes up for: every other kind earns its premium
		const holiday = holidays.find((item) => item.kind !== 'MAKEUP_WORKDAY') ?? holidays[0];
		if (
			employeeId !== undefined &&
			holiday !== undefined &&
			typeof holiday.name === 'string' &&
			holiday.name.trim() !== ''
		) {
			const names = holidayNamesByEmployee.get(employeeId) ?? new Map<string, string>();
			names.set(date, holiday.name.trim());
			holidayNamesByEmployee.set(employeeId, names);
		}
		const dayPlan = planOf(row);
		// the clock proves the person came and awards the plan; it never adds time of its own
		const clock = closedSpans(row.actual_worked_intervals);
		const plannedOt = closedSpans(row.planned_overtime_intervals);
		const awarded = awardedMinutes(plannedOt, clock) / 60;
		const timeOff = row.overtime_as_time_off === true ? awarded : 0;
		const overtime = awarded - timeOff;
		const worked = clock.length === 0 ? 0 : scheduledHours(dayPlan) + overtime;
		const paidSpans = timeOff > 0 ? [] : plannedOt;
		const empDateKey = `${employeeId}:${date}`;
		const absent =
			dayPlan.day_type === 'WORK' &&
			clock.length === 0 &&
			holiday === undefined &&
			!leaveDays.has(empDateKey);
		const leaveParts = leavePartsByDay.get(empDateKey);
		const expected = expectedShiftSpans(
			dayPlan.spans,
			leaveParts?.has('AM') === true,
			leaveParts?.has('PM') === true
		);
		const scheduledShiftMinutes = spanMinutes(dayPlan.spans);
		const expectedMinutes = spanMinutes(expected);
		const rawUndertime =
			dayPlan.day_type === 'WORK' &&
			clock.length > 0 &&
			holiday === undefined &&
			expectedMinutes > 0
				? Math.max(0, expectedMinutes - spanMinutes(overlapSpans(clock, expected)))
				: 0;
		days.push({
			date,
			terms: input.termsOf.get(owner) ?? null,
			day_type: absent ? 'ABS' : dayPlan.day_type,
			scheduled_hours: absent ? 0 : scheduledHours(dayPlan),
			scheduled_shift_minutes: scheduledShiftMinutes,
			undertime_minutes: rawUndertime > 1e-9 ? rawUndertime : 0,
			holiday_kind: typeof holiday?.kind === 'string' ? holiday.kind : '',
			worked: worked + timeOff > 0,
			worked_hours: worked,
			overtime_hours: overtime,
			clocked_shift_hours: spanMinutes(overlapSpans(clock, dayPlan.spans)) / 60,
			time_off_hours: timeOff,
			intervals: overlapSpans(clock, [...dayPlan.spans, ...paidSpans]).map(({ start, end }) => ({
				start,
				end
			})),
			overtime_intervals: overlapSpans(paidSpans, clock).map(({ start, end }) => ({ start, end }))
		});
		workDays.set(owner, days);
	}
	return { workDays, rosterDayTypes, holidaysByDate, holidayNamesByEmployee, planOf, planned };
}
