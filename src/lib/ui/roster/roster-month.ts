import { PlainDate } from '@norbital-ai/std/date';
import type { MessageKey, t } from '../t.js';
/**
 * One person-day, assembled from every source that has an opinion about it: the `work_days` row
 * (plan and clock; no `shift_definition_id` is no plan, NULL `worked_intervals` no attendance, `[]`
 * read and empty), leave, and the holiday calendar — drawn as a column overlay, so the cell still
 * says whether the person was rostered and turned up. Display only; payroll resolves day types
 * itself (`docs/architecture.md`).
 */

import type { LeaveCharge } from '../../datatypes/leave_charges.js';
import { periodDayRange, startOfDayInstant } from '../calendar.js';
import { periodMonth } from '../../../lib/payroll/run/dates.js';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { PAYROLL_TIME_ZONE, dateKey } from '../../iso-day.js';
import { formatDateISO } from '../../iso-day.js';
import { decodeNumber } from '../../wire.js';

import { attendanceBoundary, workedMinutes } from '../../attendance.js';
import { derivedBreakMinutes } from '../../scheduling/rest-break.js';
type WorkedInterval = { readonly start: string; readonly end: string | null };
import type { WorkPattern } from '../../datatypes/work_pattern.js';
import type { RosterCodeVariant } from '../../datatypes/roster_code_variant.js';
import { clockMinutes, rosterCodeKind, workWindow } from '../../scheduling/roster-code.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow
} from '../../scheduling/work-pattern.js';
import {
	dayLockKey,
	type DayLock,
	type SettlementClaim,
	type SourceLock
} from '../../scheduling/lock.js';

/** The translation callback a display helper takes, so it stays locale-reactive at the call site. */
/** A message catalogue lookup: `bolt.t`, or a test's stand-in. */
export type Translator = typeof t;

/**
 * The key every person-day map in this module is written and read by.
 *
 * `DayFacts`, the roster index, the time index and the two leave indexes are all keyed this way,
 * and both attendance surfaces look rows up with it. One spelling, one owner: two writers that
 * disagreed on the separator would give one person-day two names and quietly find nothing.
 */
export function personDayKey(employmentId: string, date: string): string {
	return `${employmentId}:${date}`;
}

/**
 * Index stored person-days by employment + payroll calendar day.
 *
 * `work_date` is a day-precision instant. Keying it with `formatDateISO` (UTC day) misses the
 * board cell and makes Mark reviewed + Save insert a second row.
 */
export function indexWorkDaysByPersonDay<
	T extends { readonly employment_id: string; readonly work_date: string }
>(days: readonly T[]): Map<string, T> {
	const byPersonDay = new Map<string, T>();
	for (const day of days) {
		byPersonDay.set(personDayKey(day.employment_id, dateKey(day.work_date)), day);
	}
	return byPersonDay;
}

type Designation = 'WORK' | 'REST' | 'OFF';

/** How this employment's days are supposed to appear on the board. */
type ScheduleKind = 'PATTERNED' | 'ROSTERED';

/** Why a planned working day has no attendance behind it, in the order an operator cares about. */
type DayStatus =
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

/** A derived conflict between two writers of one day. */
type ConflictKind = 'PENDING_LEAVE_OVERLAP' | 'LEAVE_AND_WORK';

/**
 * The assembled facts of one person-day, and everything a board or a sheet says about it.
 *
 * The schema is the single owner of the shape (this module assembles every fact it holds); the
 * derived type keeps the per-field contract above the construction, while the value itself stays a
 * plain display object that is never decoded from the wire.
 */
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
	/**
	 * THE BASE: what the employment's named shift pattern projects for this date, before anybody
	 * touched the day. `basePatternCode` names the pattern (`AM-2x2`); `baseCode` is the roster
	 * code it puts on this date and `baseKind` what that code is. All three are null when the terms
	 * name no pattern, name a rostered one, or no terms cover the date.
	 */
	readonly basePatternCode: string | null;
	readonly baseCode: string | null;
	readonly baseKind: Designation | null;
	/**
	 * THE OVERRIDE: the roster code a `work_days` row assigns, or null when the row carries no plan
	 * (or there is no row). An override replaces the base for this one date; a swap is two of them.
	 */
	readonly overrideCode: string | null;
	readonly overrideKind: Designation | null;
	/** The shift the day is worked on. Null on a rest or off day, which schedules none. */
	readonly shiftCode: string | null;
	readonly shiftStart: string | null;
	readonly shiftEnd: string | null;
	readonly shiftBreakMinutes: number | null;
	/**
	 * The holiday this person observes on the day, as payroll prices it (`observedHolidays`): the
	 * published row's name, or a rest-day holiday SUBSTITUTE carried here. Never stored on the entry.
	 */
	readonly holidayName: string | null;
	/** Where the holiday was carried here from a rest day, the date it fell on; else null. */
	readonly holidayFrom: string | null;
	readonly leaveCode: string | null;
	readonly halfDayLeave: boolean;
	/** A leave request covering the day that has not been approved yet. */
	readonly pendingLeave: boolean;
	/** Planned extra work: a WORK day whose baseline (or the holiday calendar) is not work. */
	readonly plannedOT: boolean;
	/** The approved overtime keyed on the day, in hours after the shift; null is no approval. */
	readonly approvedOvertimeHours: number | null;
	/** The planned hours beyond the overtime limit, paid as incentive; null is none. */
	readonly incentiveHours: number | null;
	readonly clockedIn: boolean;
	readonly workedIntervalCount: number;
	readonly attendanceState: 'OPEN' | 'CLOSED' | null;
	/**
	 * THE TIME ENTRIES, as a clock: the first clock-in and the last clock-out of the day, `HH:mm`
	 * in the payroll timezone, or null when no interval was recorded. `last` is null while the
	 * final interval is still open.
	 */
	readonly punchWindow: {
		readonly first: string;
		readonly last: string | null;
	} | null;
	/**
	 * The `work_days` row behind this day, or `null` when no row exists for it at all.
	 *
	 * The day sheet needs the identity, not just the numbers: recording a punch on a day that is
	 * already rostered is an UPDATE of this row, not a second one — `unique(employment_id,
	 * work_date)` says so — and recording one where no row exists is a create. Without the id the
	 * sheet would have to re-query the collection it is already looking at, and the two answers
	 * could differ by a write.
	 */
	readonly workDayId: string | null;
	/**
	 * The unpaid break the day took, derived (`derivedBreakMinutes`): the shift's granted break less
	 * the gaps already visible between the punches. `null` when no attendance was recorded.
	 */
	readonly breakMinutes: number | null;
	/**
	 * Worked minutes net of the derived break, or `null` while a punch is still open.
	 *
	 * `null` is the honest answer to an open clock rather than a running total: nobody knows how long
	 * the day was until it is closed, and a partial figure on the board would read as a short day.
	 * Computed by `workedMinutes` in `src/lib/attendance.ts`, which is the same function the entries
	 * surface and the payroll engine's inputs are measured with, so a cell and a payslip cannot
	 * disagree about the length of a day.
	 */
	readonly workedMinutes: number | null;
	/** Whether the day falls inside the attendance window the next payroll run will settle. */
	readonly withinCutoff: boolean;
	/** Derived from the company's payroll runs; drives the board's stripes and the write refusals. */
	readonly lock: DayLock;
	/** The day has already ended, which decides how loud its silence should be. */
	readonly past: boolean;
	/** Derived disagreements between the writers of this day; the board draws them as dots. */
	readonly conflicts: ReadonlyArray<ConflictKind>;
	readonly status: DayStatus;
};

/** A stored instant as every board data source reads it: one ISO-string record shape. */
type CalendarInstant = string;

type EmploymentMonthLike = {
	readonly id: string;
	/** A stored period: 0.0.1 `{ from, to }` or the bank's `{ start, end }` (`readRange` reads both). */
	readonly effective_range: unknown;
};

/** The named pattern as it rides an `employment_terms` read: `with: { term_shift_pattern }`. */
type ShiftPatternLike = {
	readonly id: string;
	readonly code: string;
	readonly pattern: WorkPattern;
	readonly effective_range?: unknown | undefined;
};

/**
 * Employment terms as the board reads them: the pointer to the named pattern, and the pattern row
 * itself when the query carried it. A term whose pointer is null is rostered as assigned; a term
 * whose row did not arrive projects nothing and says so through `termPatternRow`.
 */
type EmploymentTermLike = {
	readonly employment_id: string;
	readonly shift_pattern_id: string | null;
	readonly term_shift_pattern?: ShiftPatternLike | null | undefined;
	/** A stored period: 0.0.1 `{ from, to }` or the bank's `{ start, end }` (`readRange` reads both). */
	readonly effective_range: unknown;
};

/** A roster code as the board needs it: the display code and the variant it stands for. */
type RosterCodeDisplayLike = {
	readonly code: string;
	readonly variant: RosterCodeVariant;
};

/**
 * One person-day as every board data source reads it: both halves, both optional.
 *
 * Every column is optional because the surfaces project different subsets of the row — the board
 * needs the plan and the clock, the employee's calendar needs only what it is granted — and a
 * display shape that demanded all of them would refuse a legitimately narrower read.
 */
type WorkDayLike = {
	readonly id?: string | undefined;
	readonly employment_id: string;
	readonly work_date: CalendarInstant;
	readonly shift_definition_id?: string | null | undefined;
	readonly worked_intervals?:
		| ReadonlyArray<{
				readonly start: CalendarInstant;
				readonly end: CalendarInstant | null;
		  }>
		| null
		| undefined;
	/** The approved overtime the scheduler keyed, in hours after the shift. */
	readonly approved_overtime_hours?: number | null | undefined;
	/** The planned hours beyond the overtime limit, paid as incentive. */
	readonly incentive_hours?: number | null | undefined;
};

/**
 * The stored intervals as the attendance helpers take them, or `null` when none were recorded.
 *
 * The null is the point. `worked_intervals` of NULL means nobody has recorded attendance for this
 * day; an empty array means somebody read the day and nothing was worked. Collapsing the two into
 * `[]` would make a rostered day nobody has answered for look identical to one answered with a
 * zero, and the board's ABSENT ladder is built on exactly that difference.
 */
function attendanceIntervals(day: WorkDayLike | undefined): readonly WorkedInterval[] | null {
	if (day?.worked_intervals == null) return null;
	return day.worked_intervals.map((interval) => ({
		start: interval.start,
		end: interval.end
	}));
}

type LeaveRequestLike = {
	readonly employment_id: string;
	readonly catalogue_id: string;
	readonly from_date: CalendarInstant | null;
	readonly to_date: CalendarInstant | null;
	readonly half_day_start: boolean | null;
	readonly half_day_end: boolean | null;
	readonly charges: readonly LeaveCharge[];
};

export type HolidayLike = {
	readonly date: CalendarInstant;
	readonly name: string;
	/**
	 * The facts the per-person `given_to` rule needs. A SUBSTITUTE holiday scoped
	 * to `ONLY_IF_OFF_ON_REPLACED_DATE` is not a holiday for a person whose roster had the
	 * replaced date as WORK; the board applies the same check `resolveSchedule` does.
	 */
	readonly kind?: string | null | undefined;
	readonly replaces?: CalendarInstant | null | undefined;
	readonly given_to?: string | null | undefined;
};

/**
 * Every calendar day of a period, in order: the whole `YYYY-MM` month, or the 1st–15th / 16th–end
 * half a `-1` / `-2` suffix names. The board reads the entity's pay cycle, so its days do too.
 */
export function monthDays(period: string): PlainDate[] {
	const month = periodMonth(period);
	const { from, to } = periodDayRange(period);
	return Array.from({ length: to - from + 1 }, (_value, index) =>
		PlainDate(`${month}-${String(from + index).padStart(2, '0')}`)
	);
}

/** True when the employment exists for at least one calendar day in the selected month. */
export function employmentOverlapsMonth(employment: EmploymentMonthLike, month: string): boolean {
	const days = monthDays(month);
	const start = readRange(employment.effective_range)?.start;
	if (start == null) return false;
	const employmentStart = formatDateISO(start);
	const employmentEnd =
		readRange(employment.effective_range)?.end == null
			? null
			: formatDateISO(readRange(employment.effective_range)!.end!);
	return (
		employmentStart <= days[days.length - 1]! &&
		(employmentEnd == null || employmentEnd >= days[0]!)
	);
}

type EmploymentMonthEmptyReason = 'NONE' | 'ENDED' | 'NOT_STARTED' | 'OUTSIDE_MONTH';

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
				readRange(employment.effective_range)?.end != null &&
				formatDateISO(readRange(employment.effective_range)!.end!) < first
		)
	)
		return 'ENDED';
	if (
		employments.every(
			(employment) =>
				readRange(employment.effective_range)?.start != null &&
				formatDateISO(readRange(employment.effective_range)!.start) > last
		)
	)
		return 'NOT_STARTED';
	return 'OUTSIDE_MONTH';
}

/**
 * The company calendar as a date lookup, whole rows rather than names.
 *
 * The board draws its holiday column from this and `buildRosterMonth` overlays the same map onto
 * every person-day, so a holiday cannot be marked in the header and missing from the cells below
 * it. The whole row rides along because a SUBSTITUTE holiday may be scoped to the staff who were
 * off on the replaced date, and that rule can only be applied with `given_to` and `replaces`.
 */
export function holidaysByDate(holidays: readonly HolidayLike[]): Map<string, HolidayLike> {
	return new Map(holidays.map((holiday) => [formatDateISO(holiday.date), holiday]));
}

/** Whether a holiday falls to everyone, or only to staff who were off on the replaced date. */
function holidayAppliesToEveryone(holiday: Pick<HolidayLike, 'given_to'>): boolean {
	return holiday.given_to !== 'ONLY_IF_OFF_ON_REPLACED_DATE';
}

/** Whether an effective-dated row covers a calendar day. Shared with the app's swap logic. */
export function termCovers(term: { readonly effective_range: unknown }, date: string): boolean {
	return coversDate(term.effective_range, date);
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

/**
 * The clock reading of a stored instant, measured from the start of its work date.
 *
 * `dayStartMs` is resolved once per calendar day by `buildRosterMonth` rather than per punch: the
 * timezone lookup behind `startOfDayInstant` goes through `Intl`, and a 300-person month has
 * nine thousand cells but only thirty-one days.
 */
function punchClock(instant: string, dayStartMs: number): string {
	return dayMinutesToClock(Math.round((Date.parse(instant) - dayStartMs) / 60_000));
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
	// Only a deliberately empty attendance record means AWOL. Silence assumes the schedule.
	return facts.attendanceState === 'CLOSED' && facts.holidayName == null ? 'ABSENT' : 'PLANNED';
}

/** Everything `buildRosterMonth` needs, as one shape so its three call sites cannot disagree. */
type BuildRosterMonthOptions = {
	readonly month: string;
	readonly employments: ReadonlyArray<EmploymentMonthLike>;
	readonly workDays: ReadonlyArray<WorkDayLike>;
	readonly leaveRequests: ReadonlyArray<LeaveRequestLike>;
	/** Leave requests that have not been approved yet; drawn as pending coverage, never as taken. */
	readonly pendingLeaveRequests: ReadonlyArray<LeaveRequestLike>;
	readonly holidays: ReadonlyArray<HolidayLike>;
	readonly rosterCodesById: ReadonlyMap<string, RosterCodeDisplayLike>;
	readonly employmentTerms: ReadonlyArray<EmploymentTermLike>;
	readonly leaveCodeById: ReadonlyMap<string, string>;
	readonly cutoff: {
		readonly start: string;
		readonly end: string;
	} | null;
	/**
	 * One lock per **person-day**, keyed by `dayLockKey`, from `lockMap`.
	 *
	 * Per person, because payment is the payslip's fact: one colleague paid and another held are two
	 * different answers on the same calendar day, and a single map keyed by date could only give one.
	 */
	readonly locks: ReadonlyMap<string, DayLock>;
	readonly today: string;
	/** The entity's business timezone (the version in force's `payroll.timezone`); clocks are read in it. */
	readonly timeZone?: string | undefined;
	/**
	 * Each person's observed holidays, as payroll resolves them (`observedHolidays`). Where a person
	 * has an entry, their cells read it — so a SUBSTITUTE carry and the rest-day precedence show as
	 * payroll prices them; otherwise the published calendar is overlaid by date.
	 */
	readonly observedHolidays?: ReadonlyMap<
		string,
		ReadonlyMap<string, { readonly name: string; readonly from: string | null }>
	>;
};

/** The month's per-day indexes `factsForDate` reads, built once per month. */
type DayIndexes = {
	readonly workDay: ReadonlyMap<string, WorkDayLike>;
	readonly leave: ReadonlyMap<
		string,
		{
			readonly code: string;
			readonly halfDay: boolean;
		}
	>;
	readonly pendingLeave: ReadonlyMap<string, boolean>;
	readonly holidayByDate: ReadonlyMap<string, HolidayLike>;
};

/**
 * The month's per-day indexes: every employment/day lookup the fact assembly does.
 *
 * Leave is drawn from approved dated charges. A range can include weekends and holidays that
 * consumed no leave; two separately approved halves combine into one covered day.
 */
function buildDayIndexes(
	options: BuildRosterMonthOptions,
	first: string,
	last: string
): DayIndexes {
	const holidayByDate = holidaysByDate(options.holidays);

	const workDay = indexWorkDaysByPersonDay(options.workDays);

	const leave = new Map<string, { code: string; halfDay: boolean; days: number }>();
	for (const request of options.leaveRequests) {
		const code = options.leaveCodeById.get(request.catalogue_id) ?? 'LEAVE';
		for (const charge of request.charges) {
			if (charge.date < first || charge.date > last) continue;
			const key = personDayKey(request.employment_id, charge.date);
			const prior = leave.get(key);
			const quantity = (prior?.days ?? 0) + charge.days;
			leave.set(key, {
				code: prior != null && prior.code !== code ? `${prior.code} + ${code}` : code,
				halfDay: quantity < 1,
				days: quantity
			});
		}
	}
	const pendingLeave = new Map<string, boolean>();
	for (const request of options.pendingLeaveRequests) {
		for (const charge of request.charges)
			if (charge.date >= first && charge.date <= last)
				pendingLeave.set(personDayKey(request.employment_id, charge.date), true);
	}

	return { workDay, leave, pendingLeave, holidayByDate };
}

/**
 * Whether one holiday is this person's. A scoped `SUBSTITUTE` belongs only to the staff whose
 * roster had the replaced date off; the check is the one `resolveSchedule` makes — the explicit
 * plan first, then the pattern projection — so a board cell and a priced day cannot disagree.
 */
function holidayAppliesTo(
	holiday: HolidayLike,
	options: BuildRosterMonthOptions,
	indexes: DayIndexes,
	employmentId: string
): boolean {
	if (holidayAppliesToEveryone(holiday) || holiday.replaces == null) return true;
	const replaced = formatDateISO(holiday.replaces);
	const override = indexes.workDay.get(personDayKey(employmentId, replaced));
	const term = activeTerm(options.employmentTerms, employmentId, replaced);
	const patternRow = term == null ? null : termPatternRow(term);
	const codeId =
		override?.shift_definition_id ??
		patternRosterCodeId(patternRow?.pattern ?? null, replaced, patternAnchor(patternRow));
	const code = codeId == null ? null : options.rosterCodesById.get(codeId);
	return code == null || rosterCodeKind(code.variant) !== 'WORK';
}

/**
 * The facts of one person-day: what the roster planned, what actually happened, and why.
 *
 * The four writers of a day — the person-day row (plan and clock), leave, the holiday calendar and
 * the payroll windows — are put against each other nowhere else, which is itself why the assembly
 * lives here and not in each surface that reads it.
 */
function factsForDate(
	options: BuildRosterMonthOptions,
	indexes: DayIndexes,
	employmentId: string,
	employmentStart: string | null,
	employmentEnd: string | null,
	date: string,
	dayStartMs: number
): DayFacts {
	const key = personDayKey(employmentId, date);
	const workDay = indexes.workDay.get(key);
	const recorded = attendanceIntervals(workDay);
	const intervals = recorded ?? [];
	const leave = indexes.leave.get(key);
	const pendingLeave = indexes.pendingLeave.get(key) === true;
	const term = activeTerm(options.employmentTerms, employmentId, date);
	// The base is read through the terms row: the named pattern it points at, or rostered as
	// assigned when it points at none. A term whose pattern row did not ride the read throws here
	// rather than quietly projecting nothing, because "no base" is a fact the board paints.
	const patternRow = term == null ? null : termPatternRow(term);
	const scheduleKind =
		term == null
			? null
			: patternRow != null && 'days' in patternRow.pattern
				? 'PATTERNED'
				: 'ROSTERED';
	const baselineId = patternRosterCodeId(
		patternRow?.pattern ?? null,
		date,
		patternAnchor(patternRow)
	);
	const baselineCode = baselineId == null ? null : options.rosterCodesById.get(baselineId);
	const baselineKind = baselineCode == null ? null : rosterCodeKind(baselineCode.variant);
	const overrideId = workDay?.shift_definition_id ?? null;
	const overrideCode = overrideId == null ? null : options.rosterCodesById.get(overrideId);
	const overrideKind = overrideCode == null ? null : rosterCodeKind(overrideCode.variant);
	// The effective plan: the override when the row carries one, else the base.
	const rosterCode = overrideCode ?? baselineCode;
	const designation = rosterCode == null ? null : rosterCodeKind(rosterCode.variant);
	const window = designation === 'WORK' ? workWindow(rosterCode?.variant) : null;
	const firstPunch = recorded == null ? null : attendanceBoundary(recorded, 'FIRST');
	const lastPunch = recorded == null ? null : attendanceBoundary(recorded, 'LAST');
	const employmentState =
		employmentStart != null && date < employmentStart
			? ('BEFORE_START' as const)
			: employmentEnd != null && date > employmentEnd
				? ('EXITED' as const)
				: ('ACTIVE' as const);
	const breakTaken = recorded == null ? null : derivedBreakMinutes(recorded, window?.break_minutes);
	const holiday = indexes.holidayByDate.get(date) ?? null;
	const observed = options.observedHolidays?.get(employmentId);
	const observedHoliday = observed?.get(date) ?? null;
	const holidayName =
		observed != null
			? (observedHoliday?.name ?? null)
			: holiday != null && holidayAppliesTo(holiday, options, indexes, employmentId)
				? holiday.name
				: null;
	const conflicts: ConflictKind[] = [];
	if (pendingLeave && designation === 'WORK') conflicts.push('PENDING_LEAVE_OVERLAP');
	if (leave != null && (designation === 'WORK' || intervals.length > 0)) {
		conflicts.push('LEAVE_AND_WORK');
	}
	const partial: Omit<DayFacts, 'status'> = {
		employmentId,
		date,
		employmentState,
		designation: employmentState === 'ACTIVE' ? designation : null,
		scheduleKind: employmentState === 'ACTIVE' ? scheduleKind : null,
		basePatternCode:
			employmentState === 'ACTIVE' && baselineCode != null ? (patternRow?.code ?? null) : null,
		baseCode: employmentState === 'ACTIVE' ? (baselineCode?.code ?? null) : null,
		baseKind: employmentState === 'ACTIVE' ? baselineKind : null,
		overrideCode: employmentState === 'ACTIVE' ? (overrideCode?.code ?? null) : null,
		overrideKind: employmentState === 'ACTIVE' ? overrideKind : null,
		shiftCode:
			employmentState === 'ACTIVE' && designation === 'WORK' ? (rosterCode?.code ?? null) : null,
		shiftStart: employmentState === 'ACTIVE' ? (window?.start_time ?? null) : null,
		shiftEnd: employmentState === 'ACTIVE' ? (window?.end_time ?? null) : null,
		shiftBreakMinutes: employmentState === 'ACTIVE' ? (window?.break_minutes ?? null) : null,
		holidayName,
		holidayFrom: observedHoliday?.from ?? null,
		leaveCode: leave?.code ?? null,
		halfDayLeave: leave?.halfDay ?? false,
		pendingLeave,
		plannedOT:
			employmentState === 'ACTIVE' &&
			designation === 'WORK' &&
			(holidayName != null || baselineKind === 'REST' || baselineKind === 'OFF'),
		approvedOvertimeHours:
			employmentState === 'ACTIVE' ? storedHours(workDay?.approved_overtime_hours) : null,
		incentiveHours: employmentState === 'ACTIVE' ? storedHours(workDay?.incentive_hours) : null,
		clockedIn: intervals.length > 0,
		workedIntervalCount: intervals.length,
		attendanceState:
			recorded == null
				? null
				: recorded.some((interval) => interval.end == null)
					? 'OPEN'
					: 'CLOSED',
		punchWindow:
			firstPunch == null
				? null
				: {
						first: punchClock(firstPunch, dayStartMs),
						last: lastPunch == null ? null : punchClock(lastPunch, dayStartMs)
					},
		workDayId: workDay?.id ?? null,
		breakMinutes: breakTaken,
		// `workedMinutes` returns null for an open interval by itself, which is exactly the
		// contract this field states — so an open punch reaches the day sheet as "not known
		// yet" rather than as a number nobody should act on.
		workedMinutes: recorded == null ? null : workedMinutes(recorded, breakTaken),
		withinCutoff:
			options.cutoff != null && date >= options.cutoff.start && date <= options.cutoff.end,
		lock: options.locks.get(dayLockKey(employmentId, date)) ?? { kind: 'NONE' },
		past: date < options.today,
		conflicts
	};
	return { ...partial, status: statusOf(partial) };
}

/**
 * Build the fact table for one month.
 *
 * The per-day indexes are built once (`buildDayIndexes`) and the fact assembly for one person-day
 * is `factsForDate`.
 */
export function buildRosterMonth(options: BuildRosterMonthOptions): Map<string, DayFacts> {
	const days = monthDays(options.month);
	const first = days[0]!;
	const last = days[days.length - 1]!;
	const indexes = buildDayIndexes(options, first, last);
	const timeZone = options.timeZone ?? PAYROLL_TIME_ZONE;
	const dayStartMs = new Map(
		days.map((date) => [date, Date.parse(startOfDayInstant(date, timeZone))])
	);

	const facts = new Map<string, DayFacts>();
	for (const employment of options.employments) {
		const employmentId = employment.id;
		const employmentStart =
			readRange(employment.effective_range)?.start == null
				? null
				: formatDateISO(readRange(employment.effective_range)!.start);
		const employmentEnd =
			readRange(employment.effective_range)?.end == null
				? null
				: formatDateISO(readRange(employment.effective_range)!.end!);
		for (const date of days) {
			facts.set(
				personDayKey(employmentId, date),
				factsForDate(
					options,
					indexes,
					employmentId,
					employmentStart,
					employmentEnd,
					date,
					dayStartMs.get(date)!
				)
			);
		}
	}
	return facts;
}

/*
 * The colour budget is three. Identity rides on glyph (`statusGlyph` / `planGlyph`), density (one
 * neutral at three strengths) and shape (a dashed outline for nothing assigned). Colour is kept for
 * alarm and ownership: a running clock (warning), AWOL on a work day and conflicts (destructive,
 * the owner's call), and the payroll lock rail and holiday column (brand). A day's layers travel on
 * shape (`resolveCellLayers`); the crossing axes are separate tables (`CONFLICT_PRESENTATION`,
 * `LOCK_RAIL_PRESENTATION`, `HOLIDAY_PRESENTATION`).
 */

/**
 * How each status reads, and how loudly.
 *
 * The board's cells, the employee's calendar tiles, the day sheet's subtitle and the scheduling
 * app's exception filter all read this one table, so a day cannot be described one way in a cell and
 * another way in the control that selects it. Classes are literal variants, never assembled, so
 * Tailwind can see every one of them. The label is a catalog key so every surface resolves it
 * through the same `t`; a locale switch re-reads it everywhere at once.
 */
const STATUS_PRESENTATION: Record<
	DayStatus,
	{ readonly labelKey: MessageKey; readonly className: string }
> = {
	/**
	 * No fill and no outline: a hole in the plan, drawn as a hole. A fill would say something had
	 * been decided about this day, which is the opposite of what it means, and for a rostered
	 * employment before the month is assigned this is every cell, so it has to be the quietest
	 * thing on the board rather than nine thousand amber squares announcing a catastrophe that has
	 * not happened. The dashed outline belongs to the BASE layer now, which is a projection rather
	 * than a hole; see `LAYER_PRESENTATION`.
	 */
	UNROSTERED: {
		labelKey: 'roster.unrostered',
		className: 'text-muted-foreground/60'
	},
	/** Outside the employment: the faintest density, and `—` / `×` say which end it is outside. */
	BEFORE_START: {
		labelKey: 'roster.before_employment',
		className: 'bg-muted/25 text-muted-foreground/50'
	},
	EXITED: {
		labelKey: 'roster.employment_ended',
		className: 'bg-muted/25 text-muted-foreground/50'
	},
	/** A working day carries no fill, so the month's working shape is the figure and rest is ground. */
	PLANNED: { labelKey: 'roster.planned', className: 'text-foreground' },
	ATTENDED: { labelKey: 'roster.attended', className: 'text-foreground' },
	/** ATTENTION: a clock still running, and `⧗` says so. */
	OPEN: { labelKey: 'roster.open_punch', className: 'bg-warning/25 text-foreground' },
	/** AWOL: reviewed, nothing worked, on a day the plan expected work. The one destructive fill. */
	ABSENT: {
		labelKey: 'roster.absent',
		className: 'bg-destructive/20 font-semibold text-destructive'
	},
	/** Not a working day, and `L` / `½` is the word for it. Same density as rest and off, by design. */
	ON_LEAVE: { labelKey: 'roster.leave', className: 'bg-muted/60 text-foreground' },
	REST: { labelKey: 'roster.rest_day', className: 'bg-muted/60 text-muted-foreground' },
	OFF: { labelKey: 'roster.off_day', className: 'bg-muted/60 text-muted-foreground' }
};

/**
 * The glyph key, in the order it is worth reading, for the "Marks" disclosure under a board.
 *
 * It lives here rather than in either renderer because the board and the calendar draw the same
 * marks and a key that disagreed with a cell would be worse than no key. `mark` is the literal
 * character `statusGlyph` / `planGlyph` / `actualMark` emit, so the two cannot drift without this
 * list being edited too.
 */
export const DAY_MARK_KEY: readonly { readonly mark: string; readonly labelKey: MessageKey }[] = [
	{ mark: '·', labelKey: 'roster.unrostered' },
	{ mark: '▪', labelKey: 'roster.layer_override' },
	{ mark: '▬', labelKey: 'roster.layer_clocked' },
	{ mark: 'R', labelKey: 'roster.rest_day' },
	{ mark: 'O', labelKey: 'roster.off_day' },
	{ mark: 'L', labelKey: 'roster.leave' },
	{ mark: 'l', labelKey: 'roster.pending_leave' },
	{ mark: 'OT', labelKey: 'roster.planned_ot' },
	{ mark: '✓', labelKey: 'roster.attended' },
	{ mark: '!', labelKey: 'roster.absent' },
	{ mark: '⧗', labelKey: 'roster.open_punch' },
	{ mark: '⚑', labelKey: 'roster.conflict' },
	{ mark: '×', labelKey: 'roster.employment_ended' },
	{ mark: '—', labelKey: 'roster.before_employment' }
];

/**
 * The lock ladder, drawn as a left rail (the fill and tint are spent on status and holidays), in
 * order of permanence:
 *
 *   OPEN          nothing covers the day.
 *   IN_DRAFT_RUN  a DRAFT run's window covers it; advisory, a draft is rebuilt from the records.
 *   CONSUMED      a payslip claims this person-day; released only by deleting that payslip.
 *   PAID          a PAID run's window covers the day; corrections are adjustments.
 *
 * CONSUMED is a claim over a record, PAID arithmetic over a day (see `lib/scheduling/lock.ts`).
 */
export type LockRung = 'OPEN' | 'IN_DRAFT_RUN' | 'CONSUMED' | 'PAID';

/**
 * Which rung a person-day sits on.
 *
 * `claim` is the `payslip_adjustments` row held over this person-day, or null when no payslip has
 * taken it. It is passed in rather than looked up for the same reason `sourceLock` takes its
 * inputs: this module stays pure, so the board and the day sheet cannot compute different ladders
 * from the same month.
 */
export function lockRung(day: DayFacts, claim: SettlementClaim | null): LockRung {
	if (claim != null) return day.lock.kind === 'SETTLED' ? 'PAID' : 'CONSUMED';
	if (day.lock.kind === 'SETTLED') return 'PAID';
	if (day.lock.kind === 'IN_WINDOW') return 'IN_DRAFT_RUN';
	return 'OPEN';
}

/**
 * Whether a rung refuses a write, as opposed to merely warning about one.
 *
 * Only the two claims of permanence do. A draft run's window is advisory: the run has not paid
 * anything and will re-read whatever the records say when it is next built, so freezing a day for
 * being inside one would refuse the ordinary case — correcting a punch before payroll is committed.
 */
export function lockRungFreezes(rung: LockRung): boolean {
	return rung === 'CONSUMED' || rung === 'PAID';
}

/**
 * The `SourceLock` a rung stands for, so the hover sentence comes from `sourceLockReason` rather
 * than from a second set of words written here.
 *
 * Returns null for the two rungs that are not refusals — `OPEN` has nothing to say, and the draft
 * window's advisory line is `roster.in_payroll_window`, which the cell's own note list already
 * carries. Writing new sentences for either would give the operator two vocabularies for one fact.
 */
export function lockRungSourceLock(
	day: DayFacts,
	claim: SettlementClaim | null
): SourceLock | null {
	if (claim != null) return { kind: 'SETTLED', period: claim.period };
	if (day.lock.kind === 'SETTLED')
		return { kind: 'PAID_DAY', period: day.lock.period, date: day.date };
	return null;
}

/**
 * How each rung is drawn.
 *
 * Every class is a literal variant, never assembled from fragments, for the same reason
 * `STATUS_PRESENTATION`'s are: Tailwind scans source text, so a class built at runtime is a class
 * that is never emitted, and the rail would be invisible in production and fine in dev.
 *
 * The rail is an inset left border rather than a real border so it composes with the cell's status
 * fill instead of replacing part of it, and `padlock` is a second, redundant channel for the two
 * rungs that actually refuse a write — colour alone is not an accessible way to say "locked".
 */
export const LOCK_RAIL_PRESENTATION: Record<
	LockRung,
	{
		readonly labelKey: MessageKey;
		/** Applied to the cell; an empty string means the rung draws no rail at all. */
		readonly railClassName: string;
		/** Shown beside the plan glyph on the rungs that refuse a write. */
		readonly padlock: string;
	}
> = {
	OPEN: { labelKey: 'roster.lock_rung_open', railClassName: '', padlock: '' },
	IN_DRAFT_RUN: {
		labelKey: 'roster.lock_rung_in_draft_run',
		railClassName: 'border-l-2 border-l-brand/40',
		padlock: ''
	},
	CONSUMED: {
		labelKey: 'roster.lock_rung_consumed',
		railClassName: 'border-l-4 border-l-brand/70',
		padlock: '🔒'
	},
	PAID: {
		labelKey: 'roster.lock_rung_paid',
		railClassName: 'border-l-4 border-l-brand',
		padlock: '🔒'
	}
};

/*
 * Clock times on a work date are minutes from `startOfDayInstant(workDate, zone)` — never a local
 * reading with `Z` appended (`dates-and-time.md`), which moves an eastern punch into the previous
 * day. A night shift ending 02:00 next morning is 1560 minutes, as a roster code's window counts.
 * The zone is the entity's `payroll.timezone`; no seeded jurisdiction has a DST change inside a day.
 */

/** Minutes in a calendar day, which is also the offset a punch on the following morning carries. */
export const DAY_MINUTES = 1440;

/** How far into the work date an instant falls, in minutes, in the business timezone. */
export function minutesFromDayStart(instant: string, workDate: string, timeZone: string): number {
	const at = Date.parse(instant);
	return Math.round((at - Date.parse(startOfDayInstant(workDate, timeZone))) / 60_000);
}

/** The exact inverse: the instant that many minutes into the work date, as an ISO string. */
export function instantFromDayStart(workDate: string, minutes: number, timeZone: string): string {
	return new Date(
		Date.parse(startOfDayInstant(workDate, timeZone)) + Math.round(minutes) * 60_000
	).toISOString();
}

/** `HH:mm` for a `<input type="time">`, wrapping a next-morning punch back into a clock reading. */
export function dayMinutesToClock(minutes: number): string {
	const wrapped = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
	const hour = Math.floor(wrapped / 60);
	return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** How many whole days past the work date a punch sits — 0 today, 1 tomorrow morning. */
export function dayMinutesOffsetDays(minutes: number): number {
	return Math.floor(Math.round(minutes) / DAY_MINUTES);
}

/** `HH:mm` back to minutes from the start of the work date, given which day it lands on. */
export function clockToDayMinutes(clock: string, offsetDays: number): number | null {
	if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(clock)) return null;
	return clockMinutes(clock) + offsetDays * DAY_MINUTES;
}

/**
 * The paid length of the day the roster planned, in minutes, or null when nothing was planned.
 *
 * Midnight is crossed the same way `workforce-validation.ts` crosses it — an end at or before the
 * start belongs to the next morning — so "beyond schedule" on the day sheet and the workload check
 * at publication measure the same shift the same way.
 */
export function scheduledMinutes(
	day: Pick<DayFacts, 'shiftStart' | 'shiftEnd' | 'shiftBreakMinutes'>
): number | null {
	if (day.shiftStart == null || day.shiftEnd == null) return null;
	const start = clockMinutes(day.shiftStart);
	const rawEnd = clockMinutes(day.shiftEnd);
	const end = rawEnd <= start ? rawEnd + DAY_MINUTES : rawEnd;
	return Math.max(0, end - start - (day.shiftBreakMinutes ?? 0));
}

/**
 * Clock time past the plan — the shift AND its planned overtime — and read-only everywhere it appears.
 *
 * Overtime is planned: `work_days.approved_overtime_hours` is keyed on the day beside the shift, and
 * attendance only confirms the person was there for it. So this is unplanned time, and it is not
 * paid — a reader that treated it as an amount would be re-deriving overtime from the clock.
 *
 * Null when the day is unplanned or still open, because "beyond" needs both ends to mean anything.
 */
export function beyondPlanMinutes(
	day: Pick<
		DayFacts,
		| 'shiftStart'
		| 'shiftEnd'
		| 'shiftBreakMinutes'
		| 'workedMinutes'
		| 'approvedOvertimeHours'
		| 'incentiveHours'
	>
): number | null {
	const planned = plannedMinutes(day);
	if (planned == null || day.workedMinutes == null) return null;
	return day.workedMinutes - planned;
}

/**
 * A stored `numeric` hours column as a number, or null when unset. The wire carries `numeric` as a
 * decimal string, and `"2" + 0` is `"20"`, so every sum over these columns reads through this.
 */
export function storedHours(value: unknown): number | null {
	if (value == null) return null;
	const hours = decodeNumber(value);
	return Number.isFinite(hours) ? hours : null;
}

/**
 * The whole plan in minutes: the shift's paid length plus the overtime and incentive hours planned
 * on the day. Attendance is a presence check against all of it.
 */
export function plannedMinutes(
	day: Pick<
		DayFacts,
		'shiftStart' | 'shiftEnd' | 'shiftBreakMinutes' | 'approvedOvertimeHours' | 'incentiveHours'
	>
): number | null {
	const shift = scheduledMinutes(day);
	return shift == null
		? null
		: shift + ((day.approvedOvertimeHours ?? 0) + (day.incentiveHours ?? 0)) * 60;
}

/**
 * The planned extra time as a cell prints it — `+2h OT`, `+2h OT · +1h inc` — or null when the day
 * plans none. Both are entries on the day, never derived from the clock.
 */
export function plannedExtraLabel(
	day: Pick<DayFacts, 'approvedOvertimeHours' | 'incentiveHours'> | undefined
): string | null {
	const parts = [
		(day?.approvedOvertimeHours ?? 0) > 0
			? `+${halfHoursLabel((day?.approvedOvertimeHours ?? 0) * 60)} OT`
			: null,
		(day?.incentiveHours ?? 0) > 0
			? `+${halfHoursLabel((day?.incentiveHours ?? 0) * 60)} inc`
			: null
	].filter((part) => part != null);
	return parts.length === 0 ? null : parts.join(' · ');
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * EDITING ATTENDANCE: the same arithmetic the write path uses, so a form cannot offer a bad save.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** One interval as an editor holds it: instants, with the final end still possibly unset. */
export type IntervalDraft = {
	readonly start: string;
	readonly end: string | null;
};

/**
 * Why a draft cannot be written, in the order `work_days/+collection.ts` refuses it.
 *
 * These are not new rules. Each one names a refusal `assertWorkedIntervals` already makes, and it is
 * restated here for one reason: a form that lets the operator press Save and then shows them the
 * transform's refusal has taught them nothing about which of the four things they did wrong, and it does
 * it after a round trip. The transform stays the authority — this is the same decision, taken early
 * enough to be useful.
 */
type AttendanceDraftProblem =
	'NO_INTERVALS' | 'OUT_OF_ORDER' | 'OPEN_NOT_LAST' | 'ENDS_BEFORE_IT_STARTS';

/** What one attendance draft can honestly say about itself, before the write path speaks. */
type AttendanceDraftAssessment = {
	/** Minutes across every interval that has both ends. Fractional if the data carries seconds. */
	readonly closedMinutes: number;
	readonly hasOpenInterval: boolean;
	/** The break the day takes, derived from the punches and the shift's granted break. */
	readonly breakMinutes: number;
	/** Net worked minutes, or null while a punch is open — the same contract `DayFacts` states. */
	readonly workedMinutes: number | null;
	readonly problem: AttendanceDraftProblem | null;
};

/**
 * Assess an in-progress attendance edit against the rules the write path enforces.
 *
 * Nothing about the break is typed: it is `derivedBreakMinutes` of the draft's punches against the
 * shift's granted break, which is the same arithmetic payroll reads the stored day with.
 */
export function assessAttendanceDraft(
	intervals: readonly IntervalDraft[],
	grantedBreakMinutes: number | null | undefined
): AttendanceDraftAssessment {
	let problem: AttendanceDraftProblem | null = null;
	let previousEnd = Number.NEGATIVE_INFINITY;
	let closedMinutes = 0;
	let hasOpenInterval = false;

	for (const [index, interval] of intervals.entries()) {
		const startedAt = Date.parse(interval.start);
		const endedAt = interval.end == null ? null : Date.parse(interval.end);
		if (problem == null && index > 0 && startedAt < previousEnd) problem = 'OUT_OF_ORDER';
		if (endedAt == null) {
			hasOpenInterval = true;
			if (problem == null && index !== intervals.length - 1) problem = 'OPEN_NOT_LAST';
			previousEnd = Number.POSITIVE_INFINITY;
			continue;
		}
		if (problem == null && endedAt <= startedAt) problem = 'ENDS_BEFORE_IT_STARTS';
		if (endedAt > startedAt) closedMinutes += (endedAt - startedAt) / 60_000;
		previousEnd = endedAt;
	}

	if (problem == null && intervals.length === 0) problem = 'NO_INTERVALS';

	const breakMinutes = derivedBreakMinutes(intervals, grantedBreakMinutes);
	return {
		closedMinutes,
		hasOpenInterval,
		breakMinutes,
		workedMinutes: hasOpenInterval ? null : Math.max(0, closedMinutes - breakMinutes),
		problem
	};
}

/** The catalog key explaining a refused draft, so the sheet and any future caller say one thing. */
export const ATTENDANCE_DRAFT_PROBLEM_KEY: Record<AttendanceDraftProblem, MessageKey> = {
	NO_INTERVALS: 'roster.day_sheet_problem_no_intervals',
	OUT_OF_ORDER: 'roster.day_sheet_problem_out_of_order',
	OPEN_NOT_LAST: 'roster.day_sheet_problem_open_not_last',
	ENDS_BEFORE_IT_STARTS: 'roster.day_sheet_problem_ends_before_start'
};

/**
 * The holiday overlay, which sits on the date rather than on the person.
 *
 * It is a separate constant from `STATUS_PRESENTATION` because it is a separate axis: a cell can be
 * `ATTENDED` and on a public holiday at once, and a board that had to choose between saying those
 * two things would always be hiding one of them.
 */
export const HOLIDAY_PRESENTATION: {
	readonly mark: string;
	readonly labelKey: MessageKey;
	readonly className: string;
	readonly headerClassName: string;
} = {
	mark: 'PH',
	labelKey: 'roster.public_holiday',
	/** Body cells: translucent, so the status chip sitting inside the cell stays legible through it. */
	className: 'bg-brand/20',
	/**
	 * The day header, which is `position: sticky` and therefore must be OPAQUE. A translucent sticky
	 * cell is not a lighter shade of the header — it is a window, and the rows scrolling underneath
	 * are visible straight through it.
	 */
	headerClassName: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-100'
};

/**
 * The sentence a board header draws for a holiday.
 *
 * A holiday scoped to the staff who were off on the replaced date is named with that scope, so a
 * reader can tell why the person beside them does not carry the same mark.
 */
export function holidayTitle(holiday: HolidayLike, t: Translator): string {
	const base = `${t(HOLIDAY_PRESENTATION.labelKey)}: ${holiday.name}`;
	if (holidayAppliesToEveryone(holiday)) return base;
	return `${base} · ${t('roster.holiday_recipients', {
		date: holiday.replaces == null ? '' : formatDateISO(holiday.replaces)
	})}`;
}

/** The glyph a cell carries: the shift code when there is one, else what kind of day it is. */
function statusGlyph(day: DayFacts): string {
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
		case 'OPEN':
			return '⧗';
		/**
		 * An absence is a WORKING day, so the plan line says which shift was missed.
		 *
		 * This used to return `!`, which put the same exclamation mark on both bands of the cell — `!`
		 * over `!` — and threw away the one fact an operator chasing 725 missed clock-ins actually
		 * needs: WHICH shift nobody turned up for. The `!` belongs to the evidence line, where
		 * `actualMark` still puts it, and the two bands then disagree the way they are supposed to.
		 */
		case 'ABSENT':
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
 * How a derived conflict reads.
 *
 * Both kinds share the one destructive hue on purpose. They used to be amber and red, which made
 * the softer of the two indistinguishable from the ATTENTION fill under it — a pending-leave
 * overlap sat on a cell that was already amber for having no clock-in, and the dot vanished into
 * its own background. Red now means exactly one thing on this board: two writers disagree about
 * this day. Which two is in the mark's title and in the cell's notes, where there is room to say it.
 */
export const CONFLICT_PRESENTATION: Record<
	ConflictKind,
	{ readonly labelKey: MessageKey; readonly className: string; readonly mark: string }
> = {
	PENDING_LEAVE_OVERLAP: {
		labelKey: 'roster.conflict_pending_leave',
		className: 'bg-destructive text-destructive-foreground',
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
	const hour = decodeNumber(hourText);
	const suffix = hour >= 12 ? 'p' : 'a';
	const displayHour = hour % 12 || 12;
	return minuteText === '00' ? `${displayHour}${suffix}` : `${displayHour}:${minuteText}${suffix}`;
}

/** The punch window in the same compact form, so the clock layer reads like the plan layer. */
export function punchTimeCue(day: DayFacts | undefined): string | null {
	if (day?.punchWindow == null) return null;
	const first = shortClock(day.punchWindow.first);
	return day.punchWindow.last == null
		? `⧗ ${first}`
		: `${first}–${shortClock(day.punchWindow.last)}`;
}

/** Why a blank cell is blank — the schedule term, not just the word "unrostered". */
function unrosteredReason(day: DayFacts, t: Translator): string {
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
		day.status === 'BEFORE_START' || day.status === 'EXITED'
			? t(STATUS_PRESENTATION[day.status].labelKey)
			: describePlanLayer(day, t),
		day.holidayName == null
			? null
			: `${t(HOLIDAY_PRESENTATION.labelKey)}: ${day.holidayName}` +
				(day.holidayFrom == null
					? ''
					: ` (${t('roster.holiday_carried_from', { date: day.holidayFrom })})`),
		day.leaveCode == null
			? null
			: `${day.leaveCode}${day.halfDayLeave ? ` (${t('roster.half_day')})` : ''}`,
		day.pendingLeave ? t('roster.pending_leave') : null,
		day.plannedOT ? t('roster.planned_ot') : null,
		(day.approvedOvertimeHours ?? 0) > 0
			? t('roster.planned_overtime_hours', {
					hours: halfHoursLabel((day.approvedOvertimeHours ?? 0) * 60)
				})
			: null,
		(day.incentiveHours ?? 0) > 0
			? t('roster.planned_incentive_hours', {
					hours: halfHoursLabel((day.incentiveHours ?? 0) * 60)
				})
			: null,
		...day.conflicts.map((conflict) => t(CONFLICT_PRESENTATION[conflict].labelKey)),
		day.lock.kind === 'SETTLED'
			? t('roster.in_paid_payroll', { period: day.lock.period })
			: day.lock.kind === 'IN_WINDOW'
				? t('roster.in_payroll_window', { period: day.lock.period })
				: null,
		day.employmentState === 'ACTIVE' ? describeClockLayer(day, t) : null
	]
		.filter((part) => part != null && part !== '')
		.join(' — ');
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE LAYERS OF A DAY
 *
 * Every employment has a BASE: the day its named shift pattern projects. A `work_days` row is an
 * OVERRIDE of one date: its planned side replaces the base's roster code, and its actual side is the
 * TIME ENTRIES. Payroll uses the row when it exists (an empty interval list on a WORK day is an
 * absence) and otherwise takes the base as worked to plan with no overtime.
 *
 * `DayFacts` carries all three; this resolves them into what a cell paints, once, so the board and
 * the employee's calendar cannot disagree about which layer a mark belongs to.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */
type CellLayers = {
	/** The pattern's projection for the date, or null when nothing projects one. */
	readonly base: {
		readonly code: string;
		readonly kind: Designation;
		/** The named pattern the projection came from. */
		readonly patternCode: string | null;
	} | null;
	/** The roster row's assignment, or null when no row carries a plan for the date. */
	readonly override: {
		readonly code: string;
		readonly kind: Designation;
	} | null;
	/**
	 * What the clock says. `NONE` is no row or a row with no attendance: the plan stands and payroll
	 * assumes it. `EMPTY` is a reviewed row with nothing worked on a day that expected none. `AWOL`
	 * is that same empty row on a day the plan expected work, with no leave or holiday excusing it.
	 */
	readonly actual:
		| {
				readonly kind: 'NONE';
		  }
		| {
				readonly kind: 'EMPTY';
		  }
		| {
				readonly kind: 'AWOL';
		  }
		| {
				readonly kind: 'OPEN';
				readonly first: string;
		  }
		| {
				readonly kind: 'CLOCKED';
				readonly first: string;
				readonly last: string;
				readonly workedMinutes: number | null;
		  };
	/** Which plan layer the day is measured against. */
	readonly effective: 'BASE' | 'OVERRIDE' | 'NONE';
};

/** Which of the three layers a person-day carries, and which plan layer is in force. */
export function resolveCellLayers(day: DayFacts): CellLayers {
	const active = day.employmentState === 'ACTIVE';
	const base =
		active && day.baseCode != null && day.baseKind != null
			? { code: day.baseCode, kind: day.baseKind, patternCode: day.basePatternCode }
			: null;
	const override =
		active && day.overrideCode != null && day.overrideKind != null
			? { code: day.overrideCode, kind: day.overrideKind }
			: null;
	const actual: CellLayers['actual'] =
		day.attendanceState == null
			? { kind: 'NONE' }
			: day.attendanceState === 'OPEN'
				? { kind: 'OPEN', first: day.punchWindow?.first ?? '' }
				: day.workedIntervalCount === 0
					? { kind: day.status === 'ABSENT' ? 'AWOL' : 'EMPTY' }
					: {
							kind: 'CLOCKED',
							first: day.punchWindow?.first ?? '',
							last: day.punchWindow?.last ?? '',
							workedMinutes: day.workedMinutes
						};
	return {
		base,
		override,
		actual,
		effective: override != null ? 'OVERRIDE' : base != null ? 'BASE' : 'NONE'
	};
}

/** The plan line, layer first: which layer the code came from, then the code and its window. */
export function describePlanLayer(day: DayFacts, t: Translator): string {
	const layers = resolveCellLayers(day);
	const window =
		day.shiftStart == null || day.shiftEnd == null
			? null
			: t('roster.shift_window', {
					start: day.shiftStart,
					end: day.shiftEnd,
					break: (day.shiftBreakMinutes ?? 0) / 60
				});
	const code = (value: string) => t('roster.shift_code', { code: value });
	if (layers.override != null) {
		const origin = t('roster.layer_override');
		const over =
			layers.base == null
				? origin
				: t('roster.layer_override_over_base', { origin, base: layers.base.code });
		return [over, code(layers.override.code), window].filter((part) => part != null).join(' · ');
	}
	if (layers.base != null) {
		const from =
			layers.base.patternCode == null
				? t('roster.layer_base')
				: t('roster.layer_base_from', { pattern: layers.base.patternCode });
		return [from, code(layers.base.code), window].filter((part) => part != null).join(' · ');
	}
	if (day.status === 'UNROSTERED') return unrosteredReason(day, t);
	return t(STATUS_PRESENTATION[day.status].labelKey);
}

/** The clock line, layer first: what the time entries say, or that there are none. */
export function describeClockLayer(day: DayFacts, t: Translator): string {
	const layers = resolveCellLayers(day);
	switch (layers.actual.kind) {
		case 'CLOCKED':
			return t('roster.layer_clocked_window', {
				first: layers.actual.first,
				last: layers.actual.last,
				hours: ((layers.actual.workedMinutes ?? 0) / 60).toFixed(2)
			});
		case 'OPEN':
			return t('roster.layer_clocked_open', { first: layers.actual.first });
		case 'AWOL':
			return t('roster.layer_awol');
		case 'EMPTY':
			return t('roster.layer_empty');
		case 'NONE':
			return day.withinCutoff ? t('roster.no_attendance_in_pay_period') : t('roster.layer_none');
		default: {
			const unhandled: never = layers.actual;
			throw new Error(`Unhandled clock layer: ${String(unhandled)}`);
		}
	}
}

/**
 * ── THE SLOT ─────────────────────────────────────────────────────────────────────────────────
 *
 * One person-day is one slot, on both surfaces, and a slot is in exactly one of these states. The
 * cell no longer explains itself with a legend: the state is the fill, the plan (the code and its
 * planned overtime) is the text, and attendance is a bar that fills the slot to the length of that
 * plan — a presence check against it, never a measure of overtime.
 */
export type SlotState =
	| 'EMPTY'
	| 'UNROSTERED'
	| 'REST'
	| 'OFF'
	| 'LEAVE'
	| 'HALF_LEAVE'
	| 'PENDING_LEAVE'
	| 'WORK'
	| 'EXTRA_WORK';

export function slotState(day: DayFacts | undefined): SlotState {
	if (day == null || day.status === 'BEFORE_START' || day.status === 'EXITED') return 'EMPTY';
	if (day.leaveCode != null) return day.halfDayLeave ? 'HALF_LEAVE' : 'LEAVE';
	if (day.pendingLeave) return 'PENDING_LEAVE';
	if (day.plannedOT) return 'EXTRA_WORK';
	switch (day.status) {
		case 'REST':
			return 'REST';
		case 'OFF':
			return 'OFF';
		case 'UNROSTERED':
			return 'UNROSTERED';
		default:
			return 'WORK';
	}
}

/**
 * The code a slot prints: the rostered shift, or the one letter the state is known by.
 *
 * `dense` is the board's 60px cell: leave is `L` / `½` there, because a leave catalogue code
 * (`HOSPITALISATION`) truncates to noise at that width and the code is in the tooltip and the
 * day sheet. The calendar tile has the room and prints the code itself.
 */
export function slotCode(day: DayFacts | undefined, dense = true): string {
	const state = slotState(day);
	if (day == null || state === 'EMPTY') return '';
	if (state === 'LEAVE') return dense ? 'L' : (day.leaveCode ?? 'L');
	if (state === 'HALF_LEAVE') return dense ? '½' : `½ ${day.leaveCode ?? ''}`.trim();
	if (state === 'PENDING_LEAVE') return 'l';
	if (state === 'REST') return 'R';
	if (state === 'OFF') return 'O';
	if (state === 'UNROSTERED') return '·';
	return day.overrideCode ?? day.baseCode ?? (state === 'EXTRA_WORK' ? 'OT' : '');
}

/**
 * How attendance answers the plan: a presence check, never a source of overtime.
 *
 * The plan is the shift plus the overtime and incentive hours keyed on the day. `ratio` is worked ÷ that plan, capped
 * at one: the bar's length inside the slot. `short` is a partial day — present, but short of the
 * plan by at least half an hour, `shortMinutes` of it. Clock time past the plan is not drawn at all:
 * it is not overtime and it is not paid. A day with attendance and no shift is present, full bar.
 * An open clock has no length yet; it is drawn indeterminate. AWOL is the destructive fill.
 */
type SlotFill =
	| { readonly kind: 'NONE' }
	| { readonly kind: 'OPEN'; readonly since: string }
	| { readonly kind: 'AWOL' }
	| {
			readonly kind: 'CLOCKED';
			readonly ratio: number;
			/** Planned − worked, in minutes, floored at zero. */
			readonly shortMinutes: number;
			/** Short of the plan by more than a rounding: ten minutes under an eight-hour shift is not a short day. */
			readonly short: boolean;
			readonly workedMinutes: number;
			/** Shift plus planned overtime and incentive hours; null when no shift was planned. */
			readonly plannedMinutes: number | null;
			readonly first: string;
			readonly last: string;
	  };

export function slotFill(day: DayFacts | undefined): SlotFill {
	if (day == null || day.attendanceState == null) return { kind: 'NONE' };
	if (day.attendanceState === 'OPEN') return { kind: 'OPEN', since: day.punchWindow?.first ?? '' };
	if (day.workedIntervalCount === 0)
		return day.status === 'ABSENT' ? { kind: 'AWOL' } : { kind: 'NONE' };
	const worked = day.workedMinutes ?? 0;
	const planned = plannedMinutes(day);
	const shortMinutes = Math.max(0, (planned ?? 0) - worked);
	return {
		kind: 'CLOCKED',
		ratio: planned == null || planned <= 0 ? 1 : Math.min(1, worked / planned),
		shortMinutes,
		short: halfHours(shortMinutes) > 0,
		workedMinutes: worked,
		plannedMinutes: planned,
		first: day.punchWindow?.first ?? '',
		last: day.punchWindow?.last ?? ''
	};
}

/**
 * Worked minutes as hours to the half hour — `8h`, `8.5h` — the figure a cell prints. The bar
 * under it still carries the exact share; the label says what a person reads off a timesheet.
 */
export function halfHoursLabel(minutes: number): string {
	return `${halfHours(minutes)}h`;
}

function halfHours(minutes: number): number {
	return Math.round(minutes / 30) / 2;
}
