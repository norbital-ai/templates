import type { MessageKey } from '@norbital-ai/bolt';
import { isJsonObject } from '../../payroll_engine/foundation.js';

/** One worked interval as `roster_entry.actual_worked_intervals` stores it. */
export type Interval = {
	readonly start: string;
	readonly end: string | null;
	readonly break_minutes?: number | null;
	readonly breaks?: readonly { readonly start: string; readonly end: string }[] | null;
};

export type ShiftRow = {
	readonly id: string;
	readonly code: string;
	readonly variant: {
		readonly day_type: string;
		readonly start_time?: string | null;
		readonly end_time?: string | null;
		readonly ends_next_day?: boolean;
		readonly untimed_hours?: number | null;
		readonly breaks?: readonly {
			readonly start_time: string;
			readonly end_time: string;
			readonly paid: boolean;
		}[];
	};
};

export type PatternRow = {
	readonly id: string;
	readonly pattern: {
		readonly anchor_date?: string | null;
		readonly days?: readonly { readonly shift_definition_id?: string | null }[];
	} | null;
	readonly effective_range?: { readonly from: string; readonly to?: string | null } | null;
};

type EntryRow = {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly planned_overtime_intervals?: unknown;
	readonly actual_worked_intervals?: unknown;
	readonly findings?: unknown;
};

type LeaveRow = {
	readonly employment_id: string;
	readonly employee?: string;
	readonly days: readonly { readonly date: string; readonly part: string }[];
	readonly catalog_id?: { readonly code?: string; readonly name?: string } | null;
	readonly is_reversal?: boolean | null;
};

type HolidayRow = { readonly date: string; readonly name: string };

type Contract = {
	readonly id: string;
	readonly from: string;
	readonly to: string | null;
	readonly patternId: string | null;
	/** Where this person enters the cycle, when they run it on another phase than the pattern's. */
};

/** One roster row on the board: a person, each of their days read from the contract valid on it. */
export type Person = Contract & {
	readonly contracts?: readonly Contract[];
	/** Leave belongs to the person: one entry can run across their contracts. */
	readonly employee?: string;
};

/** One person-day as the board draws it. */
export type Day = {
	readonly date: string;
	readonly employed: boolean;
	/** The contract valid on this day; a new roster entry belongs to it. */
	readonly employmentId: string | null;
	/** Their last day of employment, once this day is past it. */
	readonly left: string | null;
	/** That last day is behind us: they have left rather than are leaving. */
	readonly gone: boolean;
	readonly entryId: string | null;
	readonly shift: string | null;
	readonly shiftId: string | null;
	readonly projectedShift: string | null;
	readonly plannedDayType: string | null;
	readonly plannedMinutes: number | null;
	readonly plannedOvertimeMinutes: number;
	/** null: no attendance recorded; []: recorded, nothing worked. */
	readonly intervals: readonly Interval[] | null;
	readonly actualMinutes: number | null;
	readonly percent: number | null;
	readonly attendanceDue: boolean;
	readonly holiday: string | null;
	readonly leave: { readonly label: string; readonly half: boolean } | null;
	readonly locked: boolean;
	readonly findings: readonly string[];
};

export const dayKey = (employmentId: string, date: string): string => `${employmentId}:${date}`;

export function addDays(date: string, days: number): string {
	const stamp = new Date(`${date}T00:00:00Z`);
	stamp.setUTCDate(stamp.getUTCDate() + days);
	return stamp.toISOString().slice(0, 10);
}

/** Every `YYYY-MM-DD` from `from` to `to`, both inclusive. */
export function datesBetween(from: string, to: string): string[] {
	const dates: string[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
	return dates;
}

export const isWeekend = (date: string): boolean => {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 || day === 6;
};

/** The stored intervals, or null when none were recorded (or the value is not a list of intervals). */
export function intervalsOf(value: unknown): Interval[] | null {
	if (!Array.isArray(value)) return null;
	const intervals: Interval[] = [];
	for (const item of value) {
		if (!isJsonObject(item) || typeof item.start !== 'string') return null;
		const end = item.end == null ? null : String(item.end);
		const breaks = Array.isArray(item.breaks)
			? item.breaks.flatMap((span) =>
					isJsonObject(span) && typeof span.start === 'string' && typeof span.end === 'string'
						? [{ start: span.start, end: span.end }]
						: []
				)
			: undefined;
		intervals.push({
			start: item.start,
			end,
			break_minutes: typeof item.break_minutes === 'number' ? item.break_minutes : null,
			breaks: breaks ?? null
		});
	}
	return intervals;
}

/** Minutes of one interval net of its recorded breaks, or null while it is still open. */
const intervalMinutes = (interval: Interval): number | null => {
	if (interval.end == null) return null;
	const start = Date.parse(interval.start),
		end = Date.parse(interval.end);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
	// a break carried both as a total and as dated intervals counts once
	let pause =
		(interval.breaks?.length ?? 0) > 0 || typeof interval.break_minutes !== 'number'
			? 0
			: interval.break_minutes;
	for (const span of interval.breaks ?? []) {
		const from = Date.parse(span.start),
			to = Date.parse(span.end);
		if (Number.isFinite(from) && Number.isFinite(to) && to > from) pause += (to - from) / 60_000;
	}
	return Math.max(0, (end - start) / 60_000 - pause);
};

/** Minutes worked, or null while an interval is still open. */
export function workedMinutes(intervals: readonly Interval[] | null): number | null {
	if (intervals == null) return null;
	let minutes = 0;
	for (const interval of intervals) {
		const held = intervalMinutes(interval);
		if (held == null) return null;
		minutes += held;
	}
	return Math.round(minutes);
}

/** `8.5h`: hours to two decimals, trimmed. */
export const hoursLabel = (minutes: number): string => `${Math.round((minutes / 60) * 100) / 100}h`;

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clockMinutes = (clock: string): number =>
	Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** The shift's scheduled minutes for a working day, net of its unpaid breaks. */
export function shiftMinutes(shift: ShiftRow | undefined): number | null {
	const variant = shift?.variant;
	if (variant == null) return null;
	if (variant.day_type !== 'WORK') return 0;
	const start = variant.start_time,
		end = variant.end_time;
	if (start == null || end == null || !CLOCK.test(start) || !CLOCK.test(end))
		return variant.untimed_hours == null ? null : Math.round(variant.untimed_hours * 60);
	let span = clockMinutes(end) - clockMinutes(start);
	if (span <= 0 || variant.ends_next_day) span += 1440;
	let pause = 0;
	for (const pauseSpan of variant.breaks ?? [])
		if (!pauseSpan.paid && CLOCK.test(pauseSpan.start_time) && CLOCK.test(pauseSpan.end_time))
			pause += Math.max(0, clockMinutes(pauseSpan.end_time) - clockMinutes(pauseSpan.start_time));
	return Math.max(0, span - pause);
}

/** The cycle day a date falls on, or null when there is no cycle to place it in. */
export const cycleShiftId = (pattern: PatternRow | undefined, date: string): string | null => {
	const days = pattern?.pattern?.days;
	const anchor = pattern?.pattern?.anchor_date ?? pattern?.effective_range?.from;
	const to = pattern?.effective_range?.to ?? null;
	if (days == null || days.length === 0 || anchor == null) return null;
	if (date < anchor) return null;
	if (to != null && date > to) return null;
	const span =
		Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000) %
		days.length;
	const offset = span < 0 ? span + days.length : span;
	const id = days[offset]?.shift_definition_id;
	return id == null || id === '' ? null : String(id);
};

/** The stored findings; a finding without a message keeps its code. */
const findingsOf = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isJsonObject(item)) return [];
		const message = typeof item.message === 'string' ? item.message : null;
		const code = typeof item.code === 'string' ? item.code : null;
		return message ?? code ?? [];
	});
};

/** Every roster-person-day of `dates`, keyed `dayKey(employment, date)`. */
export function buildDays(input: {
	readonly dates: readonly string[];
	readonly people: readonly Person[];
	readonly entries: readonly EntryRow[];
	readonly shifts: readonly ShiftRow[];
	readonly patterns: readonly PatternRow[];
	readonly holidays: readonly HolidayRow[];
	readonly leave: readonly LeaveRow[];
	readonly locked: ReadonlySet<string>;
	readonly today: string;
}): Map<string, Day> {
	const entries = new Map(
		input.entries.map((row) => [dayKey(row.employment_id, String(row.work_date).slice(0, 10)), row])
	);
	const holidays = new Map(input.holidays.map((row) => [String(row.date).slice(0, 10), row.name]));
	const leave = new Map<string, { codes: Set<string>; parts: Set<string> }>();
	for (const row of input.leave) {
		if (row.is_reversal === true) continue;
		for (const slot of row.days) {
			if (!input.dates.includes(slot.date)) continue;
			const key = dayKey(row.employee ?? row.employment_id, slot.date);
			const before = leave.get(key) ?? { codes: new Set<string>(), parts: new Set<string>() };
			const code = row.catalog_id?.code ?? row.catalog_id?.name;
			if (code != null && code !== '') before.codes.add(code);
			before.parts.add(slot.part);
			leave.set(key, before);
		}
	}
	const shifts = new Map(input.shifts.map((row) => [String(row.id), row]));
	const patterns = new Map(input.patterns.map((row) => [String(row.id), row]));
	const days = new Map<string, Day>();
	for (const person of input.people) {
		const contracts = person.contracts ?? [person];
		const ends = contracts.flatMap(({ to }) => (to == null ? [] : [to]));
		const lastDay = ends.length < contracts.length ? null : (ends.toSorted().at(-1) ?? null);
		for (const date of input.dates) {
			const key = dayKey(person.id, date);
			const contract = contracts.find(({ from, to }) => from <= date && (to == null || date <= to));
			const pattern = contract?.patternId == null ? undefined : patterns.get(contract.patternId);
			const entry = contract == null ? undefined : entries.get(dayKey(contract.id, date));
			const shiftId = entry?.shift_definition_id == null ? null : String(entry.shift_definition_id);
			const employed = contract !== undefined;
			// a pattern projects only inside the contract that names it
			const projectedId = shiftId == null ? cycleShiftId(pattern, date) : null;
			const plannedId = shiftId ?? projectedId;
			const planned = plannedId == null ? undefined : shifts.get(plannedId);
			const plannedMinutes = shiftMinutes(planned);
			const plannedOvertimeMinutes =
				workedMinutes(intervalsOf(entry?.planned_overtime_intervals)) ?? 0;
			const intervals = intervalsOf(entry?.actual_worked_intervals);
			const actualMinutes = workedMinutes(intervals);
			const target = (plannedMinutes ?? 0) + plannedOvertimeMinutes;
			const off = leave.get(dayKey(person.employee ?? person.id, date));
			days.set(key, {
				date,
				employed,
				employmentId: contract?.id ?? null,
				left: lastDay != null && date > lastDay ? lastDay : null,
				gone: lastDay != null && input.today > lastDay,
				entryId: entry?.id ?? null,
				shift: shiftId == null ? null : (planned?.code ?? shiftId),
				shiftId,
				projectedShift: projectedId == null ? null : (shifts.get(projectedId)?.code ?? projectedId),
				plannedDayType: planned?.variant.day_type ?? null,
				plannedMinutes,
				plannedOvertimeMinutes,
				intervals,
				actualMinutes,
				percent:
					target > 0 && actualMinutes != null
						? Math.min(100, Math.floor((actualMinutes / target) * 100))
						: null,
				attendanceDue: date < input.today,
				holiday: holidays.get(date) ?? null,
				leave:
					off == null
						? null
						: {
								label: `${[...off.codes].join('/')}${
									off.parts.size < 2 ? ` ${[...off.parts].join('/')}` : ''
								}`.trim(),
								half: off.parts.size < 2
							},
				locked: input.locked.has(person.id),
				findings: findingsOf(entry?.findings)
			});
		}
	}
	return days;
}

/** A recorded empty attendance on an uncovered, due working day. */
export const isAbsent = (day: Day): boolean =>
	day.employed &&
	day.shiftId != null &&
	day.attendanceDue &&
	day.intervals != null &&
	day.intervals.length === 0 &&
	day.plannedDayType === 'WORK' &&
	day.holiday == null &&
	(day.leave == null || day.leave.half);

/** A due working day with no attendance at all. */
export const isUnrecorded = (day: Day): boolean =>
	day.employed &&
	day.shiftId != null &&
	day.attendanceDue &&
	day.intervals == null &&
	day.plannedDayType === 'WORK' &&
	day.holiday == null &&
	(day.leave == null || day.leave.half);

/** The recorded calendar date and clock, in the entity's zone. */
export const clockStampOf = (instant: string, timeZone: string): string =>
	new Intl.DateTimeFormat('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(new Date(instant));

type Translator = (key: MessageKey, vars?: { readonly [name: string]: string | number }) => string;

/** Everything the cell shows, in words: its accessible name and hover text. */
export function describeDay(day: Day, subject: string, timeZone: string, t: Translator): string {
	if (day.left != null)
		return `${subject} · ${t(day.gone ? 'roster.left_on' : 'roster.leaving_on', { date: day.left })}`;
	if (!day.employed) return `${subject} · ${t('roster.outside_employment')}`;
	const parts = [subject];
	if (day.holiday != null) parts.push(`${t('roster.public_holiday')}: ${day.holiday}`);
	if (day.leave != null) parts.push(`${t('roster.leave')}: ${day.leave.label}`);
	if (day.projectedShift != null)
		parts.push(`${t('roster.plan_projected')}: ${day.projectedShift}`);
	parts.push(`${t('roster.plan_recorded')}: ${day.shift ?? '—'}`);
	if (day.plannedOvertimeMinutes > 0)
		parts.push(`${t('roster.planned_overtime')}: ${hoursLabel(day.plannedOvertimeMinutes)}`);
	const first = day.intervals?.[0];
	if (day.intervals == null)
		parts.push(t(day.shiftId != null ? 'roster.attendance_missing' : 'roster.not_scheduled'));
	else if (first == null) {
		if (isAbsent(day)) parts.push(t('roster.layer_awol'));
	} else
		parts.push(
			day.actualMinutes == null
				? t('roster.layer_clocked_open', { first: clockStampOf(first.start, timeZone) })
				: t('roster.layer_clocked_window', {
						first: clockStampOf(first.start, timeZone),
						last: clockStampOf(day.intervals.at(-1)?.end ?? first.start, timeZone),
						hours: Math.round((day.actualMinutes / 60) * 100) / 100
					})
		);
	if (day.percent != null)
		parts.push(
			t('roster.completion_details', {
				percent: day.percent,
				credited: hoursLabel(day.actualMinutes ?? 0),
				target: hoursLabel((day.plannedMinutes ?? 0) + day.plannedOvertimeMinutes)
			})
		);
	for (const finding of day.findings) parts.push(finding);
	if (day.locked) parts.push(t('roster.lock_rung_consumed'));
	return parts.join(' · ');
}
