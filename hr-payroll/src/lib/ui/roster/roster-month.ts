/**
 * One person-day, assembled from every source that has an opinion about it.
 *
 * A roster says what was *planned*; a time entry says whether the person *appeared*; leave and the
 * holiday calendar say why an empty day is empty. Shown separately these are four screens nobody
 * cross-references, which is how a rostered shift with no attendance stays invisible until payroll.
 * Merged into one cell they answer the question an operator actually has: is this day settled, and
 * if not, what is wrong with it.
 *
 * A public holiday is NOT one of those answers. It is a property of the calendar rather than of one
 * person's roster — `roster_entries` has no holiday arm for the same reason — so it is carried here
 * as an overlay on the date and drawn as a column of the board, leaving each cell free to keep
 * saying what that person's day is. A holiday that replaced the cell would hide whether the person
 * was rostered to work it and whether they turned up, which is precisely what an operator needs to
 * know about a holiday.
 *
 * Display only. Nothing here prices anything — the payroll engine resolves day types itself from the
 * same rows, and `docs/architecture.md` is the authority on how.
 */

import { calendarDayKey, daysInMonth } from '../calendar.js';
import type { RosterCodeVariant } from '../../../custom-types/roster_code_variant/+definition.js';
import type { WorkPattern } from '../../../custom-types/work_pattern/+definition.js';
import { rosterCodeKind, workWindow } from '../../scheduling/roster-code.js';
import { patternRosterCodeId } from '../../scheduling/work-pattern.js';
import type { DayLock } from '../../scheduling/lock.js';
import type { I18nApi } from '@norbital-ai/ui/i18n';
import type { TenantI18nKeys } from '$bolt/i18n-keys';

/** The translation callback a display helper takes, so it stays locale-reactive at the call site. */
export type Translator = I18nApi<TenantI18nKeys>['t'];

export type Designation = 'WORK' | 'REST' | 'OFF';

/** How this employment's days are supposed to appear on the board. */
export type ScheduleKind = 'PATTERNED' | 'ROSTERED';

/** Why a planned working day has no attendance behind it, in the order an operator cares about. */
export type DayStatus =
	| 'BEFORE_START'
	| 'EXITED'
	| 'UNROSTERED'
	| 'PLANNED'
	| 'ATTENDED'
	| 'OPEN'
	| 'ABSENT'
	| 'ON_LEAVE'
	| 'REST'
	| 'OFF';

export type DayFacts = {
	readonly employmentId: string;
	readonly date: string;
	readonly employmentState: 'BEFORE_START' | 'ACTIVE' | 'EXITED';
	/** `null` when no roster entry covers the day at all. */
	readonly designation: Designation | null;
	/**
	 * The employment's schedule term for this date. A repeating week fills itself in; a monthly
	 * roster stays blank until somebody assigns the day. `null` when no term covers the date.
	 */
	readonly scheduleKind: ScheduleKind | null;
	/** The shift the day is worked on. Null on a rest or off day, which schedules none. */
	readonly shiftCode: string | null;
	readonly shiftStart: string | null;
	readonly shiftEnd: string | null;
	readonly shiftBreakMinutes: number | null;
	/** The source roster token, e.g. `AMRES` or `OFF/S`, when the roster carried one. */
	readonly assignmentCode: string | null;
	/** Where the explicit entry came from: `IMPORT`, `MANUAL`, or null when none exists. */
	readonly origin: string | null;
	/** Overlaid from `company_holidays`, never stored on the entry. */
	readonly holidayName: string | null;
	readonly leaveCode: string | null;
	readonly halfDayLeave: boolean;
	/** A leave request covering the day that has not been approved yet. */
	readonly pendingLeave: boolean;
	/** Planned extra work: a WORK day whose baseline (or the holiday calendar) is not work. */
	readonly plannedOT: boolean;
	readonly clockedIn: boolean;
	readonly workedIntervalCount: number;
	readonly attendanceState: 'OPEN' | 'CLOSED' | null;
	/** Whether the day falls inside the attendance window the next payroll run will settle. */
	readonly withinCutoff: boolean;
	/** Derived from the company's payroll runs; drives the board's stripes and the write refusals. */
	readonly lock: DayLock;
	/** The day has already ended, which decides how loud its silence should be. */
	readonly past: boolean;
	/** Derived disagreements between the writers of this day; the board draws them as dots. */
	readonly conflicts: readonly ConflictKind[];
	readonly status: DayStatus;
};

/** A derived conflict between two writers of one day. */
export type ConflictKind = 'PENDING_LEAVE_OVERLAP' | 'LEAVE_AND_WORK';

export type EmploymentMonthLike = {
	readonly norbital_id: string;
	readonly effective_range: {
		readonly start?: string | Date;
		readonly end?: string | Date;
	} | null;
};

export type RosterEntryLike = {
	readonly employment_id: string;
	readonly work_date: string | Date;
	readonly shift_definition_id: string;
	readonly assignment_code: string | null;
	readonly origin?: string | null;
};

export type EmploymentTermLike = {
	readonly employment_id: string;
	readonly work_pattern: WorkPattern;
	readonly effective_range: {
		readonly start?: string | Date;
		readonly end?: string | Date;
	} | null;
};

export type RosterCodeDisplayLike = {
	readonly code: string;
	readonly variant: RosterCodeVariant;
};

export type TimeEntryLike = {
	readonly employment_id: string;
	readonly work_date: string | Date;
	readonly worked_intervals:
		| readonly {
				readonly start_at: string | Date;
				readonly end_at: string | Date | null;
		  }[]
		| null;
};

export type LeaveRequestLike = {
	readonly employment_id: string;
	readonly kind: string | null;
	readonly leave_type_id: string;
	readonly from_date: string | Date | null;
	readonly to_date: string | Date | null;
	readonly half_day_start: boolean | null;
	readonly half_day_end: boolean | null;
};

export type HolidayLike = {
	readonly date: string | Date;
	readonly name: string;
};

/** Every calendar day of a `YYYY-MM` month, in order. */
export function monthDays(month: string): string[] {
	const count = daysInMonth(month);
	return Array.from(
		{ length: count },
		(_value, index) => `${month}-${String(index + 1).padStart(2, '0')}`
	);
}

/** True when the employment exists for at least one calendar day in the selected month. */
export function employmentOverlapsMonth(employment: EmploymentMonthLike, month: string): boolean {
	const days = monthDays(month);
	const start = employment.effective_range?.start;
	if (start == null) return false;
	const employmentStart = calendarDayKey(start);
	const employmentEnd =
		employment.effective_range?.end == null ? null : calendarDayKey(employment.effective_range.end);
	return (
		employmentStart <= days[days.length - 1]! &&
		(employmentEnd == null || employmentEnd >= days[0]!)
	);
}

export type EmploymentMonthEmptyReason = 'NONE' | 'ENDED' | 'NOT_STARTED' | 'OUTSIDE_MONTH';

/** Explain an empty month without implying that loading succeeded with no employment records. */
export function employmentMonthEmptyReason(
	employments: readonly EmploymentMonthLike[],
	month: string
): EmploymentMonthEmptyReason {
	if (employments.length === 0) return 'NONE';
	const days = monthDays(month);
	const first = days[0]!;
	const last = days[days.length - 1]!;
	if (
		employments.every(
			(employment) =>
				employment.effective_range?.end != null &&
				calendarDayKey(employment.effective_range.end) < first
		)
	)
		return 'ENDED';
	if (
		employments.every(
			(employment) =>
				employment.effective_range?.start != null &&
				calendarDayKey(employment.effective_range.start) > last
		)
	)
		return 'NOT_STARTED';
	return 'OUTSIDE_MONTH';
}

/**
 * The company calendar as a date lookup.
 *
 * The board draws its holiday column from this and `buildRosterMonth` overlays the same map onto
 * every person-day, so a holiday cannot be marked in the header and missing from the cells below it.
 */
export function holidayNamesByDate(holidays: readonly HolidayLike[]): Map<string, string> {
	return new Map(holidays.map((holiday) => [calendarDayKey(holiday.date), holiday.name]));
}

function termCovers(term: EmploymentTermLike, date: string): boolean {
	if (term.effective_range?.start == null || term.work_pattern == null) return false;
	const start = calendarDayKey(term.effective_range.start);
	const end = term.effective_range.end == null ? null : calendarDayKey(term.effective_range.end);
	return date >= start && (end == null || date <= end);
}

function activeTerm(
	terms: readonly EmploymentTermLike[],
	employmentId: string,
	date: string
): EmploymentTermLike | null {
	return (
		terms.find((term) => term.employment_id === employmentId && termCovers(term, date)) ?? null
	);
}

function scheduleKindOf(patternValue: unknown): ScheduleKind | null {
	if (patternValue == null || typeof patternValue !== 'object') return null;
	const type = 'type' in patternValue ? patternValue.type : null;
	return type === 'PATTERNED' || type === 'ROSTERED' ? type : null;
}

/**
 * Decide what one cell says, most specific reason first.
 *
 * Approved leave outranks an absence for the obvious reason: the person is not missing, they are on
 * leave, and calling that an absence is how a payroll ends up docking somebody who filed properly.
 *
 * A public holiday is not in this ladder at all — it is an overlay, not a status — but it does stop
 * a day being called an absence: nobody is expected to appear on a gazetted holiday, so a rostered
 * working day with no punches on one has not gone wrong.
 */
function statusOf(facts: Omit<DayFacts, 'status'>): DayStatus {
	if (facts.employmentState === 'BEFORE_START') return 'BEFORE_START';
	if (facts.employmentState === 'EXITED') return 'EXITED';
	if (facts.leaveCode != null) return 'ON_LEAVE';
	if (facts.designation === 'REST') return 'REST';
	if (facts.designation === 'OFF') return 'OFF';
	if (facts.designation == null) return 'UNROSTERED';
	if (facts.attendanceState === 'OPEN') return 'OPEN';
	if (facts.clockedIn) return 'ATTENDED';
	// A planned working day still in the future has simply not happened yet; one already inside the
	// window the next run will settle, with nothing clocked, is an absence somebody must explain.
	return facts.withinCutoff && facts.holidayName == null ? 'ABSENT' : 'PLANNED';
}

/**
 * Build the fact table for one month.
 *
 * `leaveRequests` are expanded across their whole range here rather than in the query, because a
 * request is stored once at its `from_date` and a calendar needs every day it covers.
 */
export function buildRosterMonth(options: {
	readonly month: string;
	readonly employments: readonly EmploymentMonthLike[];
	readonly rosterEntries: readonly RosterEntryLike[];
	readonly timeEntries: readonly TimeEntryLike[];
	readonly leaveRequests: readonly LeaveRequestLike[];
	/** Leave requests that have not been approved yet; drawn as pending coverage, never as taken. */
	readonly pendingLeaveRequests: readonly LeaveRequestLike[];
	readonly holidays: readonly HolidayLike[];
	readonly rosterCodesById: ReadonlyMap<string, RosterCodeDisplayLike>;
	readonly employmentTerms: readonly EmploymentTermLike[];
	readonly leaveCodeById: ReadonlyMap<string, string>;
	readonly cutoff: { readonly start: string; readonly end: string } | null;
	/** One lock per date, derived from the company's payroll runs by `lockMap`. */
	readonly locks: ReadonlyMap<string, DayLock>;
	readonly today: string;
}): Map<string, DayFacts> {
	const days = monthDays(options.month);
	const first = days[0]!;
	const last = days[days.length - 1]!;

	const holidayByDate = holidayNamesByDate(options.holidays);

	const rosterByKey = new Map<string, RosterEntryLike>();
	for (const entry of options.rosterEntries) {
		rosterByKey.set(`${entry.employment_id}:${calendarDayKey(entry.work_date)}`, entry);
	}

	const timeByKey = new Map<string, TimeEntryLike>();
	for (const entry of options.timeEntries) {
		timeByKey.set(`${entry.employment_id}:${calendarDayKey(entry.work_date)}`, entry);
	}

	const leaveByKey = new Map<string, { code: string; halfDay: boolean }>();
	for (const request of options.leaveRequests) {
		if (request.kind !== 'TIME_OFF' || request.from_date == null || request.to_date == null)
			continue;
		const from = calendarDayKey(request.from_date);
		const to = calendarDayKey(request.to_date);
		if (to < first || from > last) continue;
		const code = options.leaveCodeById.get(request.leave_type_id) ?? 'LEAVE';
		for (const date of days) {
			if (date < from || date > to) continue;
			const halfDay =
				(date === from && request.half_day_start === true) ||
				(date === to && request.half_day_end === true);
			leaveByKey.set(`${request.employment_id}:${date}`, { code, halfDay });
		}
	}
	const pendingLeaveByKey = new Map<string, boolean>();
	for (const request of options.pendingLeaveRequests) {
		if (request.kind !== 'TIME_OFF' || request.from_date == null || request.to_date == null)
			continue;
		const from = calendarDayKey(request.from_date);
		const to = calendarDayKey(request.to_date);
		if (to < first || from > last) continue;
		for (const date of days) {
			if (date < from || date > to) continue;
			pendingLeaveByKey.set(`${request.employment_id}:${date}`, true);
		}
	}

	const facts = new Map<string, DayFacts>();
	for (const employment of options.employments) {
		const employmentId = employment.norbital_id;
		const employmentStart =
			employment.effective_range?.start == null
				? null
				: calendarDayKey(employment.effective_range.start);
		const employmentEnd =
			employment.effective_range?.end == null
				? null
				: calendarDayKey(employment.effective_range.end);
		for (const date of days) {
			const key = `${employmentId}:${date}`;
			const roster = rosterByKey.get(key);
			const time = timeByKey.get(key);
			const leave = leaveByKey.get(key);
			const pendingLeave = pendingLeaveByKey.get(key) === true;
			const term = activeTerm(options.employmentTerms, employmentId, date);
			const scheduleKind = term == null ? null : scheduleKindOf(term.work_pattern);
			const projectedId =
				roster == null && term != null ? patternRosterCodeId(term.work_pattern, date) : null;
			const rosterCodeId = roster?.shift_definition_id ?? projectedId;
			const rosterCode = rosterCodeId == null ? null : options.rosterCodesById.get(rosterCodeId);
			const designation = rosterCode == null ? null : rosterCodeKind(rosterCode.variant);
			const baselineId = term == null ? null : patternRosterCodeId(term.work_pattern, date);
			const baselineCode = baselineId == null ? null : options.rosterCodesById.get(baselineId);
			const baselineKind = baselineCode == null ? null : rosterCodeKind(baselineCode.variant);
			const window = designation === 'WORK' ? workWindow(rosterCode?.variant) : null;
			const employmentState =
				employmentStart != null && date < employmentStart
					? ('BEFORE_START' as const)
					: employmentEnd != null && date > employmentEnd
						? ('EXITED' as const)
						: ('ACTIVE' as const);
			const holidayName = holidayByDate.get(date) ?? null;
			const conflicts: ConflictKind[] = [];
			if (pendingLeave && designation === 'WORK') conflicts.push('PENDING_LEAVE_OVERLAP');
			if (leave != null && (designation === 'WORK' || (time?.worked_intervals?.length ?? 0) > 0)) {
				conflicts.push('LEAVE_AND_WORK');
			}
			const partial: Omit<DayFacts, 'status'> = {
				employmentId,
				date,
				employmentState,
				designation: employmentState === 'ACTIVE' ? designation : null,
				scheduleKind: employmentState === 'ACTIVE' ? scheduleKind : null,
				shiftCode:
					employmentState === 'ACTIVE' && designation === 'WORK'
						? (rosterCode?.code ?? null)
						: null,
				shiftStart: employmentState === 'ACTIVE' ? (window?.start_time ?? null) : null,
				shiftEnd: employmentState === 'ACTIVE' ? (window?.end_time ?? null) : null,
				shiftBreakMinutes: employmentState === 'ACTIVE' ? (window?.break_minutes ?? null) : null,
				assignmentCode: roster?.assignment_code ?? null,
				origin: roster?.origin ?? null,
				holidayName,
				leaveCode: leave?.code ?? null,
				halfDayLeave: leave?.halfDay ?? false,
				pendingLeave,
				plannedOT:
					employmentState === 'ACTIVE' &&
					designation === 'WORK' &&
					(holidayName != null || baselineKind === 'REST' || baselineKind === 'OFF'),
				clockedIn: (time?.worked_intervals?.length ?? 0) > 0,
				workedIntervalCount: time?.worked_intervals?.length ?? 0,
				attendanceState:
					time == null
						? null
						: time.worked_intervals?.some((interval) => interval.end_at == null)
							? 'OPEN'
							: 'CLOSED',
				withinCutoff:
					options.cutoff != null && date >= options.cutoff.start && date <= options.cutoff.end,
				lock: options.locks.get(date) ?? { kind: 'NONE' },
				past: date < options.today,
				conflicts
			};
			facts.set(key, { ...partial, status: statusOf(partial) });
		}
	}
	return facts;
}

/**
 * How each status reads, and how loudly.
 *
 * The board's cells, its legend and the scheduling app's filter all read this one table, so a day
 * cannot be described one way in a cell and another way in the control that selects it. Classes are
 * literal variants, never assembled, so Tailwind can see every one of them. The label is a catalog
 * key so every surface resolves it through the same `t`; a locale switch re-reads it everywhere at
 * once.
 */
export const STATUS_PRESENTATION: Record<
	DayStatus,
	{ readonly labelKey: TenantI18nKeys; readonly className: string }
> = {
	UNROSTERED: {
		labelKey: 'roster.unrostered',
		className: 'bg-warning/15 text-warning-foreground'
	},
	BEFORE_START: {
		labelKey: 'roster.before_employment',
		className: 'bg-info/15 text-info'
	},
	EXITED: {
		labelKey: 'roster.employment_ended',
		className: 'bg-destructive/10 text-destructive'
	},
	PLANNED: {
		labelKey: 'roster.planned',
		className: 'bg-brand/15 text-brand'
	},
	ATTENDED: { labelKey: 'roster.attended', className: 'bg-success/15 text-success-foreground' },
	OPEN: { labelKey: 'roster.open_punch', className: 'bg-warning/25 text-warning-foreground' },
	ABSENT: {
		labelKey: 'roster.absent',
		className: 'bg-destructive/20 font-semibold text-destructive'
	},
	ON_LEAVE: { labelKey: 'roster.leave', className: 'bg-info/20 text-info' },
	REST: { labelKey: 'roster.rest_day', className: 'bg-muted text-muted-foreground' },
	OFF: { labelKey: 'roster.off_day', className: 'bg-muted/60 text-muted-foreground' }
};

/**
 * The holiday overlay, which sits on the date rather than on the person.
 *
 * It is a separate constant from `STATUS_PRESENTATION` because it is a separate axis: a cell can be
 * `ATTENDED` and on a public holiday at once, and a board that had to choose between saying those
 * two things would always be hiding one of them.
 */
export const HOLIDAY_PRESENTATION = {
	mark: 'PH',
	labelKey: 'roster.public_holiday' as TenantI18nKeys,
	/** Body cells: translucent, so the status chip sitting inside the cell stays legible through it. */
	className: 'bg-brand/20',
	/**
	 * The day header, which is `position: sticky` and therefore must be OPAQUE. A translucent sticky
	 * cell is not a lighter shade of the header — it is a window, and the rows scrolling underneath
	 * are visible straight through it.
	 */
	headerClassName: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-100'
} as const;

/** The glyph a cell carries: the shift code when there is one, else what kind of day it is. */
export function statusGlyph(day: DayFacts): string {
	switch (day.status) {
		case 'BEFORE_START':
			return '—';
		case 'EXITED':
			return '×';
		case 'ON_LEAVE':
			return day.halfDayLeave ? '½' : 'L';
		case 'REST':
			return 'R';
		case 'OFF':
			return 'O';
		case 'UNROSTERED':
			return '·';
		case 'ABSENT':
			return '!';
		case 'OPEN':
			return '⧗';
		case 'ATTENDED':
		case 'PLANNED':
			return day.shiftCode ?? 'W';
		default: {
			const unhandled: never = day.status;
			throw new Error(`Unhandled day status: ${String(unhandled)}`);
		}
	}
}

/**
 * The plan line of a cell: what the roster says the day is, before anything happened.
 *
 * Planned extra work (a WORK day over a rest, off or holiday baseline) reads as `OT` so it is
 * visible at a glance; pending leave reads as `l` so nobody mistakes it for a taken day.
 */
export function planGlyph(day: DayFacts): string {
	if (day.status === 'BEFORE_START') return '—';
	if (day.status === 'EXITED') return '×';
	if (day.pendingLeave) return 'l';
	if (day.plannedOT) return 'OT';
	return statusGlyph(day);
}

/**
 * The evidence line of a cell: what actually happened, one mark.
 *
 * This is the observation axis, so it can always disagree with the plan — that disagreement is
 * the product, not an error. A blank mark means there is nothing to say yet.
 */
export function actualMark(day: DayFacts): string {
	if (day.attendanceState === 'OPEN') return '⧗';
	if (day.clockedIn) return '✓';
	if (day.status === 'ABSENT') return '!';
	return '·';
}

export function actualMarkClass(day: DayFacts): string {
	if (day.attendanceState === 'OPEN') return 'text-warning-foreground';
	if (day.clockedIn) return 'text-success-foreground';
	if (day.status === 'ABSENT') return 'text-destructive';
	return 'text-muted-foreground';
}

/** How a derived conflict reads, and how loudly. */
export const CONFLICT_PRESENTATION: Record<
	ConflictKind,
	{ readonly labelKey: TenantI18nKeys; readonly className: string; readonly mark: string }
> = {
	PENDING_LEAVE_OVERLAP: {
		labelKey: 'roster.conflict_pending_leave',
		className: 'bg-warning text-warning-foreground',
		mark: '⚑'
	},
	LEAVE_AND_WORK: {
		labelKey: 'roster.conflict_leave_work',
		className: 'bg-destructive text-destructive-foreground',
		mark: '⚑'
	}
};

function shortClock(value: string): string {
	const [hourText, minuteText] = value.split(':');
	const hour = Number(hourText);
	const suffix = hour >= 12 ? 'p' : 'a';
	const displayHour = hour % 12 || 12;
	return minuteText === '00' ? `${displayHour}${suffix}` : `${displayHour}:${minuteText}${suffix}`;
}

/** Compact second line for a dense cell; the tooltip carries the complete clock window. */
export function shiftTimeCue(day: DayFacts | undefined): string | null {
	if (day?.shiftStart == null || day.shiftEnd == null) return null;
	return `${shortClock(day.shiftStart)}–${shortClock(day.shiftEnd)}`;
}

/** Why a blank cell is blank — the schedule term, not just the word "unrostered". */
export function unrosteredReason(day: DayFacts, t: Translator): string {
	switch (day.scheduleKind) {
		case 'ROSTERED':
			return t('roster.unrostered_monthly');
		case 'PATTERNED':
			return t('roster.unrostered_pattern');
		case null:
			return t('roster.unrostered_no_pattern');
		default: {
			const unhandled: never = day.scheduleKind;
			throw new Error(`Unhandled schedule kind: ${String(unhandled)}`);
		}
	}
}

/** One line describing everything known about a day, for a cell's hover text. */
export function describeDay(day: DayFacts | undefined, heading: string, t: Translator): string {
	if (day == null) return heading;
	return [
		heading,
		day.status === 'UNROSTERED'
			? unrosteredReason(day, t)
			: t(STATUS_PRESENTATION[day.status].labelKey),
		day.shiftCode == null ? null : t('roster.shift_code', { code: day.shiftCode }),
		day.shiftStart == null || day.shiftEnd == null
			? null
			: t('roster.shift_window', {
					start: day.shiftStart,
					end: day.shiftEnd,
					break: (day.shiftBreakMinutes ?? 0) / 60
				}),
		day.assignmentCode == null ? null : t('roster.assignment_code', { code: day.assignmentCode }),
		day.holidayName == null ? null : `${t(HOLIDAY_PRESENTATION.labelKey)}: ${day.holidayName}`,
		day.leaveCode == null
			? null
			: `${day.leaveCode}${day.halfDayLeave ? ` (${t('roster.half_day')})` : ''}`,
		day.pendingLeave ? t('roster.pending_leave') : null,
		day.plannedOT ? t('roster.planned_ot') : null,
		...day.conflicts.map((conflict) => t(CONFLICT_PRESENTATION[conflict].labelKey)),
		day.lock.kind === 'SETTLED'
			? t('roster.in_paid_payroll', { period: day.lock.period })
			: day.lock.kind === 'IN_WINDOW'
				? t('roster.in_payroll_window', { period: day.lock.period })
				: null,
		day.attendanceState === 'OPEN'
			? t('roster.attendance_open')
			: day.workedIntervalCount > 0
				? t('roster.attendance_intervals', { count: day.workedIntervalCount })
				: day.withinCutoff
					? t('roster.no_attendance_in_pay_period')
					: t('roster.no_attendance')
	]
		.filter((part) => part != null && part !== '')
		.join(' — ');
}

/** A tally of the month by status, for the board's summary strip. */
export function summarizeRosterMonth(facts: ReadonlyMap<string, DayFacts>): Map<DayStatus, number> {
	const counts = new Map<DayStatus, number>();
	for (const day of facts.values()) {
		counts.set(day.status, (counts.get(day.status) ?? 0) + 1);
	}
	return counts;
}

/**
 * How far the month has got: not drafted, being drafted, or published.
 *
 * This is the difference between an empty month and a broken one, and the board has to draw it
 * because the two look identical in the tally. A month nobody has opened yet has every person-day
 * unrostered — three hundred people times thirty-one days is nine thousand of them — and reporting
 * that as an exception in alarm red says a catastrophe has happened where in fact nothing has
 * happened at all. An unrostered day only becomes a fault once the month has been published, which
 * is the point at which the roster claims to be complete.
 */
export type MonthDrafting = 'NOT_DRAFTED' | 'DRAFT' | 'PUBLISHED';

export type MonthProgress = {
	readonly drafting: MonthDrafting;
	/** People times days: the size of the month, and the denominator of everything below. */
	readonly personDays: number;
	readonly rostered: number;
	readonly unrostered: number;
	/** People with at least one active day that still has no shift. */
	readonly peopleNeedingAssignment: number;
	/**
	 * The things somebody has to act on now. Attendance faults always count; an unrostered day
	 * counts only in a published month, where it is a hole rather than unfinished work.
	 */
	readonly exceptions: readonly { readonly status: DayStatus; readonly count: number }[];
};

/** Statuses that mean a person-day needs somebody, once the month is far enough along to say so. */
const ATTENDANCE_EXCEPTIONS: readonly DayStatus[] = ['ABSENT', 'OPEN'];

export function monthProgress(
	facts: ReadonlyMap<string, DayFacts>,
	drafting: MonthDrafting
): MonthProgress {
	const counts = summarizeRosterMonth(facts);
	const personDays = facts.size - (counts.get('BEFORE_START') ?? 0) - (counts.get('EXITED') ?? 0);
	const unrostered = counts.get('UNROSTERED') ?? 0;
	const needing = new Set<string>();
	for (const day of facts.values()) {
		if (day.status === 'UNROSTERED') needing.add(day.employmentId);
	}
	const statuses: DayStatus[] =
		drafting === 'PUBLISHED'
			? [...ATTENDANCE_EXCEPTIONS, 'UNROSTERED']
			: [...ATTENDANCE_EXCEPTIONS];
	return {
		drafting,
		personDays,
		rostered: personDays - unrostered,
		unrostered,
		peopleNeedingAssignment: needing.size,
		exceptions: statuses
			.map((status) => ({ status, count: counts.get(status) ?? 0 }))
			.filter((entry) => entry.count > 0)
	};
}
