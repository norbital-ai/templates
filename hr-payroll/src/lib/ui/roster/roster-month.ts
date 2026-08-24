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

import { Schema } from 'effect';
import { daysInMonth, startOfDayInstant } from '../calendar.js';
import { formatDateISO } from '@norbital-ai/std/date';
import { workedMinutes } from '../../attendance.js';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { workPatternValueSchema } from '../../../datatypes/work_pattern/+definition.js';
import { rosterCodeVariantValueSchema } from '../../../datatypes/roster_code_variant/+definition.js';
import { clockMinutes, rosterCodeKind, workWindow } from '../../scheduling/roster-code.js';
import { patternRosterCodeId } from '../../scheduling/work-pattern.js';
import {
	dayLockSchema,
	type DayLock,
	type SettlementClaim,
	type SourceLock
} from '../../scheduling/lock.js';
import type { I18nApi } from '@norbital-ai/ui/i18n';
import type { TenantI18nKeys } from '$bolt/i18n-keys';

/** The translation callback a display helper takes, so it stays locale-reactive at the call site. */
export type Translator = I18nApi<TenantI18nKeys>['t'];

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

const designationSchema = Schema.Literals(['WORK', 'REST', 'OFF']);
type Designation = Schema.Schema.Type<typeof designationSchema>;

/** How this employment's days are supposed to appear on the board. */
const scheduleKindSchema = Schema.Literals(['PATTERNED', 'ROSTERED']);
type ScheduleKind = Schema.Schema.Type<typeof scheduleKindSchema>;

/** Why a planned working day has no attendance behind it, in the order an operator cares about. */
const dayStatusSchema = Schema.Literals([
	'BEFORE_START',
	'EXITED',
	'UNROSTERED',
	'PLANNED',
	'ATTENDED',
	'OPEN',
	'ABSENT',
	'ON_LEAVE',
	'REST',
	'OFF'
]);
export type DayStatus = Schema.Schema.Type<typeof dayStatusSchema>;

/** A derived conflict between two writers of one day. */
const conflictKindSchema = Schema.Literals(['PENDING_LEAVE_OVERLAP', 'LEAVE_AND_WORK']);
type ConflictKind = Schema.Schema.Type<typeof conflictKindSchema>;

/**
 * The assembled facts of one person-day, and everything a board or a sheet says about it.
 *
 * The schema is the single owner of the shape (this module assembles every fact it holds); the
 * derived type keeps the per-field contract above the construction, while the value itself stays a
 * plain display object that is never decoded from the wire.
 */
const dayFactsSchema = Schema.Struct({
	employmentId: Schema.String,
	date: Schema.String,
	employmentState: Schema.Literals(['BEFORE_START', 'ACTIVE', 'EXITED']),
	/** `null` when no roster entry covers the day at all. */
	designation: Schema.NullOr(designationSchema),
	/**
	 * The employment's schedule term for this date. A repeating week fills itself in; a monthly
	 * roster stays blank until somebody assigns the day. `null` when no term covers the date.
	 */
	scheduleKind: Schema.NullOr(scheduleKindSchema),
	/** The shift the day is worked on. Null on a rest or off day, which schedules none. */
	shiftCode: Schema.NullOr(Schema.String),
	shiftStart: Schema.NullOr(Schema.String),
	shiftEnd: Schema.NullOr(Schema.String),
	shiftBreakMinutes: Schema.NullOr(Schema.Number),
	/** The source roster token, e.g. `AMRES` or `OFF/S`, when the roster carried one. */
	assignmentCode: Schema.NullOr(Schema.String),
	/** Where the explicit entry came from: `IMPORT`, `MANUAL`, or null when none exists. */
	origin: Schema.NullOr(Schema.String),
	/** Overlaid from `company_holidays`, never stored on the entry. */
	holidayName: Schema.NullOr(Schema.String),
	leaveCode: Schema.NullOr(Schema.String),
	halfDayLeave: Schema.Boolean,
	/** A leave request covering the day that has not been approved yet. */
	pendingLeave: Schema.Boolean,
	/** Planned extra work: a WORK day whose baseline (or the holiday calendar) is not work. */
	plannedOT: Schema.Boolean,
	clockedIn: Schema.Boolean,
	workedIntervalCount: Schema.Number,
	attendanceState: Schema.NullOr(Schema.Literals(['OPEN', 'CLOSED'])),
	/**
	 * The `time_entries` row behind this day, or `null` when nobody has recorded one.
	 *
	 * The day sheet needs the identity, not just the numbers: editing a punch is an update of *this*
	 * record, and recording one where none exists is a create. Without the id the sheet would have to
	 * re-query the collection it is already looking at, and the two answers could differ by a write.
	 */
	timeEntryId: Schema.NullOr(Schema.String),
	/** The unpaid break the entry records, in whole minutes. `null` when there is no entry. */
	breakMinutes: Schema.NullOr(Schema.Number),
	/**
	 * Worked minutes net of the unpaid break, or `null` when a punch is still open.
	 *
	 * `null` is the honest answer to an open clock rather than a running total: nobody knows how long
	 * the day was until it is closed, and a partial figure on the board would read as a short day.
	 * Computed by `workedMinutes` in `src/lib/attendance.ts`, which is the same function the entries
	 * surface and the payroll engine's inputs are measured with, so a cell and a payslip cannot
	 * disagree about the length of a day.
	 */
	workedMinutes: Schema.NullOr(Schema.Number),
	/** Whether the day falls inside the attendance window the next payroll run will settle. */
	withinCutoff: Schema.Boolean,
	/** Derived from the company's payroll runs; drives the board's stripes and the write refusals. */
	lock: dayLockSchema,
	/** The day has already ended, which decides how loud its silence should be. */
	past: Schema.Boolean,
	/** Derived disagreements between the writers of this day; the board draws them as dots. */
	conflicts: Schema.Array(conflictKindSchema),
	status: dayStatusSchema
});
export type DayFacts = Schema.Schema.Type<typeof dayFactsSchema>;

/** A stored instant as every board data source reads it: one ISO-string record shape. */
const calendarInstantSchema = Schema.String;

/** The one effective-range shape every effective-dated row carries. */
const effectiveRangeLikeSchema = Schema.Struct({
	start: Schema.optional(calendarInstantSchema),
	end: Schema.optional(Schema.NullOr(calendarInstantSchema))
});

const employmentMonthLikeSchema = Schema.Struct({
	id: Schema.String,
	effective_range: Schema.NullOr(effectiveRangeLikeSchema)
});
type EmploymentMonthLike = Schema.Schema.Type<typeof employmentMonthLikeSchema>;

const rosterEntryLikeSchema = Schema.Struct({
	employment_id: Schema.String,
	work_date: calendarInstantSchema,
	shift_definition_id: Schema.String,
	assignment_code: Schema.NullOr(Schema.String),
	origin: Schema.optional(Schema.NullOr(Schema.String))
});
type RosterEntryLike = Schema.Schema.Type<typeof rosterEntryLikeSchema>;

const employmentTermLikeSchema = Schema.Struct({
	employment_id: Schema.String,
	work_pattern: workPatternValueSchema,
	effective_range: Schema.NullOr(effectiveRangeLikeSchema)
});
type EmploymentTermLike = Schema.Schema.Type<typeof employmentTermLikeSchema>;

/** A roster code as the board needs it: the display code and the variant it stands for. */
const rosterCodeDisplayLikeSchema = Schema.Struct({
	code: Schema.String,
	variant: rosterCodeVariantValueSchema
});
type RosterCodeDisplayLike = Schema.Schema.Type<typeof rosterCodeDisplayLikeSchema>;

const timeEntryLikeSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	employment_id: Schema.String,
	work_date: calendarInstantSchema,
	worked_intervals: Schema.NullOr(
		Schema.Array(
			Schema.Struct({
				start: calendarInstantSchema,
				end: Schema.NullOr(calendarInstantSchema)
			})
		)
	),
	break_minutes: Schema.optional(Schema.NullOr(Schema.Number))
});
type TimeEntryLike = Schema.Schema.Type<typeof timeEntryLikeSchema>;

/**
 * The stored intervals as the attendance helpers take them.
 *
 * Local and remote reads both expose ISO strings, so this adapter only removes the nullable row
 * wrapper before the arithmetic receives the intervals.
 */
function toWorkedIntervals(entry: TimeEntryLike | undefined): readonly WorkedInterval[] {
	return (entry?.worked_intervals ?? []).map((interval) => ({
		start: interval.start,
		end: interval.end
	}));
}

const leaveRequestLikeSchema = Schema.Struct({
	employment_id: Schema.String,
	kind: Schema.NullOr(Schema.String),
	leave_type_id: Schema.String,
	from_date: Schema.NullOr(calendarInstantSchema),
	to_date: Schema.NullOr(calendarInstantSchema),
	half_day_start: Schema.NullOr(Schema.Boolean),
	half_day_end: Schema.NullOr(Schema.Boolean)
});
type LeaveRequestLike = Schema.Schema.Type<typeof leaveRequestLikeSchema>;

const holidayLikeSchema = Schema.Struct({
	date: calendarInstantSchema,
	name: Schema.String
});
type HolidayLike = Schema.Schema.Type<typeof holidayLikeSchema>;

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
	const employmentStart = formatDateISO(start);
	const employmentEnd =
		employment.effective_range?.end == null ? null : formatDateISO(employment.effective_range.end);
	return (
		employmentStart <= days[days.length - 1]! &&
		(employmentEnd == null || employmentEnd >= days[0]!)
	);
}

const employmentMonthEmptyReasonSchema = Schema.Literals([
	'NONE',
	'ENDED',
	'NOT_STARTED',
	'OUTSIDE_MONTH'
]);
type EmploymentMonthEmptyReason = Schema.Schema.Type<typeof employmentMonthEmptyReasonSchema>;

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
				formatDateISO(employment.effective_range.end) < first
		)
	)
		return 'ENDED';
	if (
		employments.every(
			(employment) =>
				employment.effective_range?.start != null &&
				formatDateISO(employment.effective_range.start) > last
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
	return new Map(holidays.map((holiday) => [formatDateISO(holiday.date), holiday.name]));
}

function termCovers(term: EmploymentTermLike, date: string): boolean {
	if (term.effective_range?.start == null || term.work_pattern == null) return false;
	const start = formatDateISO(term.effective_range.start);
	const end = term.effective_range.end == null ? null : formatDateISO(term.effective_range.end);
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

/** Everything `buildRosterMonth` needs, as one shape so its three call sites cannot disagree. */
const buildRosterMonthOptionsSchema = Schema.Struct({
	month: Schema.String,
	employments: Schema.Array(employmentMonthLikeSchema),
	rosterEntries: Schema.Array(rosterEntryLikeSchema),
	timeEntries: Schema.Array(timeEntryLikeSchema),
	leaveRequests: Schema.Array(leaveRequestLikeSchema),
	/** Leave requests that have not been approved yet; drawn as pending coverage, never as taken. */
	pendingLeaveRequests: Schema.Array(leaveRequestLikeSchema),
	holidays: Schema.Array(holidayLikeSchema),
	rosterCodesById: Schema.ReadonlyMap(Schema.String, rosterCodeDisplayLikeSchema),
	employmentTerms: Schema.Array(employmentTermLikeSchema),
	leaveCodeById: Schema.ReadonlyMap(Schema.String, Schema.String),
	cutoff: Schema.NullOr(Schema.Struct({ start: Schema.String, end: Schema.String })),
	/** One lock per date, derived from the company's payroll runs by `lockMap`. */
	locks: Schema.ReadonlyMap(Schema.String, dayLockSchema),
	today: Schema.String
});
type BuildRosterMonthOptions = Schema.Schema.Type<typeof buildRosterMonthOptionsSchema>;

/** The month's per-day indexes `factsForDate` reads, built once per month. */
const dayIndexesSchema = Schema.Struct({
	roster: Schema.ReadonlyMap(Schema.String, rosterEntryLikeSchema),
	time: Schema.ReadonlyMap(Schema.String, timeEntryLikeSchema),
	leave: Schema.ReadonlyMap(
		Schema.String,
		Schema.Struct({ code: Schema.String, halfDay: Schema.Boolean })
	),
	pendingLeave: Schema.ReadonlyMap(Schema.String, Schema.Boolean),
	holidayByDate: Schema.ReadonlyMap(Schema.String, Schema.String)
});
type DayIndexes = Schema.Schema.Type<typeof dayIndexesSchema>;

/**
 * The month's per-day indexes: every employment/day lookup the fact assembly does.
 *
 * `leaveRequests` are expanded across their whole range here rather than in the query, because a
 * request is stored once at its `from_date` and a calendar needs every day it covers.
 */
function buildDayIndexes(
	options: BuildRosterMonthOptions,
	days: readonly string[],
	first: string,
	last: string
): DayIndexes {
	const holidayByDate = holidayNamesByDate(options.holidays);

	const roster = new Map<string, RosterEntryLike>();
	for (const entry of options.rosterEntries) {
		roster.set(personDayKey(entry.employment_id, formatDateISO(entry.work_date)), entry);
	}

	const time = new Map<string, TimeEntryLike>();
	for (const entry of options.timeEntries) {
		time.set(personDayKey(entry.employment_id, formatDateISO(entry.work_date)), entry);
	}

	const leave = new Map<string, { code: string; halfDay: boolean }>();
	for (const request of options.leaveRequests) {
		if (request.kind !== 'TIME_OFF' || request.from_date == null || request.to_date == null)
			continue;
		const from = formatDateISO(request.from_date);
		const to = formatDateISO(request.to_date);
		if (to < first || from > last) continue;
		const code = options.leaveCodeById.get(request.leave_type_id) ?? 'LEAVE';
		const halfStart = request.half_day_start === true;
		const halfEnd = request.half_day_end === true;
		const fromIndex = days.findIndex((date) => date >= from);
		const toIndex = days.findLastIndex((date) => date <= to);
		for (let index = fromIndex; index >= 0 && index <= toIndex && index < days.length; index += 1) {
			const date = days[index]!;
			leave.set(personDayKey(request.employment_id, date), {
				code,
				halfDay: (halfStart && date === from) || (halfEnd && date === to)
			});
		}
	}

	const pendingLeave = new Map<string, boolean>();
	for (const request of options.pendingLeaveRequests) {
		if (request.kind !== 'TIME_OFF' || request.from_date == null || request.to_date == null)
			continue;
		const from = formatDateISO(request.from_date);
		const to = formatDateISO(request.to_date);
		if (to < first || from > last) continue;
		const fromIndex = days.findIndex((date) => date >= from);
		const toIndex = days.findLastIndex((date) => date <= to);
		for (let index = fromIndex; index >= 0 && index <= toIndex && index < days.length; index += 1) {
			pendingLeave.set(personDayKey(request.employment_id, days[index]!), true);
		}
	}

	return { roster, time, leave, pendingLeave, holidayByDate };
}

/**
 * The facts of one person-day: what the roster planned, what actually happened, and why.
 *
 * The five writers of a day — roster, time entry, leave, holiday calendar, payroll windows — are
 * put against each other nowhere else, which is itself why the assembly lives here and not in each
 * surface that reads it.
 */
function factsForDate(
	options: BuildRosterMonthOptions,
	indexes: DayIndexes,
	employmentId: string,
	employmentStart: string | null,
	employmentEnd: string | null,
	date: string
): DayFacts {
	const key = personDayKey(employmentId, date);
	const roster = indexes.roster.get(key);
	const time = indexes.time.get(key);
	const intervals = toWorkedIntervals(time);
	const leave = indexes.leave.get(key);
	const pendingLeave = indexes.pendingLeave.get(key) === true;
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
	const holidayName = indexes.holidayByDate.get(date) ?? null;
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
		shiftCode:
			employmentState === 'ACTIVE' && designation === 'WORK' ? (rosterCode?.code ?? null) : null,
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
		clockedIn: intervals.length > 0,
		workedIntervalCount: intervals.length,
		attendanceState:
			time == null ? null : intervals.some((interval) => interval.end == null) ? 'OPEN' : 'CLOSED',
		timeEntryId: time?.id ?? null,
		breakMinutes: time == null ? null : (time.break_minutes ?? 0),
		// `workedMinutes` returns null for an open interval by itself, which is exactly the
		// contract this field states — so an open punch reaches the day sheet as "not known
		// yet" rather than as a number nobody should act on.
		workedMinutes: time == null ? null : workedMinutes(intervals, time.break_minutes),
		withinCutoff:
			options.cutoff != null && date >= options.cutoff.start && date <= options.cutoff.end,
		lock: options.locks.get(date) ?? { kind: 'NONE' },
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
	const indexes = buildDayIndexes(options, days, first, last);

	const facts = new Map<string, DayFacts>();
	for (const employment of options.employments) {
		const employmentId = employment.id;
		const employmentStart =
			employment.effective_range?.start == null
				? null
				: formatDateISO(employment.effective_range.start);
		const employmentEnd =
			employment.effective_range?.end == null
				? null
				: formatDateISO(employment.effective_range.end);
		for (const date of days) {
			facts.set(
				personDayKey(employmentId, date),
				factsForDate(options, indexes, employmentId, employmentStart, employmentEnd, date)
			);
		}
	}
	return facts;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE COLOUR BUDGET, and why it is three.
 *
 * Every status used to own a hue: amber unrostered, blue not-started, red exited, brand planned,
 * green attended, amber open, red absent, blue leave, grey rest, grey off. Ten fills, none of which
 * means anything until you have read the swatch that names it — so the board could not be read
 * without looking away from it, and the strip that named them ran to three wrapped lines. Colour was
 * being spent on IDENTITY, which is the one job a letter does better: `R`, `O`, `L` and a shift code
 * are already the words for those days, and a glyph needs no key at all.
 *
 * So identity moved onto channels that carry it for free:
 *
 *   GLYPH     which kind of day this is — `statusGlyph` / `planGlyph`, unchanged.
 *   DENSITY   one neutral at three strengths: outside the employment (faintest), a non-working day,
 *             a working day (no fill at all, so the month's working shape is what stands out).
 *   SHAPE     a dashed inset outline means "nothing has been assigned here" — an absence drawn as
 *             an absence of ink, which no fill can say.
 *
 * and colour was left to the three facts that are genuinely about ALARM or OWNERSHIP rather than
 * about identity:
 *
 *   ATTENTION (warning)     a day somebody must act on — no clock-in, or a clock still running.
 *                           One hue, two glyphs: `!` and `⧗`. They are the same call to action.
 *   CONFLICT  (destructive) two writers disagree about one day. The only red left on the board, so
 *                           red now means exactly one thing, and it is rare enough to be worth it.
 *   PAYROLL   (brand)       the lock rail and the public-holiday column. Both are "something other
 *                           than the roster owns this", drawn on two channels that never collide.
 *
 * A status therefore contributes AT MOST a neutral density here. Anything louder is a separate
 * table — `CONFLICT_PRESENTATION`, `LOCK_RAIL_PRESENTATION`, `HOLIDAY_PRESENTATION` — because those
 * axes cross a status rather than replacing it: a day can be attended, on a holiday, and locked.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * How each status reads, and how loudly.
 *
 * The board's cells, the employee's calendar tiles, the day sheet's subtitle and the scheduling
 * app's exception filter all read this one table, so a day cannot be described one way in a cell and
 * another way in the control that selects it. Classes are literal variants, never assembled, so
 * Tailwind can see every one of them. The label is a catalog key so every surface resolves it
 * through the same `t`; a locale switch re-reads it everywhere at once.
 */
export const STATUS_PRESENTATION: Record<
	DayStatus,
	{ readonly labelKey: TenantI18nKeys; readonly className: string }
> = {
	/**
	 * No fill and a dashed inset outline: a hole in the plan, drawn as a hole. A fill would say
	 * something had been decided about this day, which is the opposite of what it means — and in a
	 * month nobody has opened yet this is every cell, so it has to be the quietest thing on the board
	 * rather than nine thousand amber squares announcing a catastrophe that has not happened.
	 */
	UNROSTERED: {
		labelKey: 'roster.unrostered',
		className:
			'text-muted-foreground outline-1 outline-dashed outline-offset-[-2px] outline-muted-foreground/50'
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
	/** The two ATTENTION states. One hue; `⧗` and `!` say which, and `!` is the heavier of the two. */
	OPEN: { labelKey: 'roster.open_punch', className: 'bg-warning/25 text-foreground' },
	ABSENT: {
		labelKey: 'roster.absent',
		className: 'bg-warning/25 font-semibold text-foreground'
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
export const DAY_MARK_KEY: readonly { readonly mark: string; readonly labelKey: TenantI18nKeys }[] =
	[
		{ mark: '·', labelKey: 'roster.unrostered' },
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
 * The lock ladder, as one channel with four values and nothing else on it.
 *
 * A cell already spends its fill on `STATUS_PRESENTATION` and its background tint on the holiday
 * overlay, so lock state cannot be another fill without one of those three facts going missing.
 * It is drawn as a left rail instead: a channel nothing else uses, which is what makes "why can't
 * I click this" have exactly one place to look.
 *
 * The rungs are ordered by how permanent they are, and they come from two different sources on
 * purpose:
 *
 *   OPEN          nothing covers the day.
 *   IN_DRAFT_RUN  the day falls inside a DRAFT run's assessment window. Advisory only — a draft is
 *                 rebuilt from the records, so editing one is ordinary work, not a violation.
 *   CONSUMED      a `payslip_sources` row claims *this attendance record*. Stored, exact, and
 *                 released only by deleting the payslip — and so the run — that holds it.
 *   PAID          a PAID run's window covers the day. Permanent; corrections are adjustments.
 *
 * `CONSUMED` reads a claim over a record and `PAID` reads arithmetic over a day, and that is the
 * distinction `src/lib/scheduling/lock.ts` and `payslip_sources/+model.ts` both argue at length:
 * a record is settled because a payslip took it, not because of the date it carries. A day with no
 * record at all has no claim to ask, so the window is the only answer available for it — which is
 * why the two live on one ladder rather than in two places.
 */
const lockRungSchema = Schema.Literals(['OPEN', 'IN_DRAFT_RUN', 'CONSUMED', 'PAID']);
export type LockRung = Schema.Schema.Type<typeof lockRungSchema>;

/**
 * Which rung a person-day sits on.
 *
 * `claim` is the `payslip_sources` row held over this day's time entry, or null when no payslip has
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
		readonly labelKey: TenantI18nKeys;
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

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * CLOCK TIMES ON A WORK DATE, and why they are measured from the start of the day rather than
 * converted through the browser.
 *
 * A punch is an instant; an operator edits a wall clock. Between the two sits a timezone, and the
 * one wrong answer — appending `Z` to a local reading — is the error `dates-and-time.md` names
 * outright, because east of Greenwich it silently moves the punch into the previous day.
 *
 * So the anchor is `startOfDayInstant(workDate, PAYROLL_TIME_ZONE)`: the exact instant the work
 * date begins in the business zone, resolved through `Intl` by `calendar.ts`. Every end of every
 * interval is then held as MINUTES FROM THAT ANCHOR. Reading is exact subtraction and needs no
 * timezone logic at all; writing is exact addition. A night shift that ends at 02:00 the next
 * morning is 1560 minutes, which is the same way a roster code's own window models an `end_time`
 * that is not after its `start_time`, so the plan band and the actual band count in one unit.
 *
 * The one assumption: no daylight-saving transition falls inside the work date. That holds for
 * `PAYROLL_TIME_ZONE` (Asia/Kuala_Lumpur observes none) and for every jurisdiction the seed bank
 * carries. A zone that did observe one would put an hour-long error into a single day per year,
 * and the honest fix then is a per-company zone on the company record rather than a second
 * conversion here — the template already refuses to guess a zone on import for the same reason.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

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
export function scheduledMinutes(day: DayFacts): number | null {
	if (day.shiftStart == null || day.shiftEnd == null) return null;
	const start = clockMinutes(day.shiftStart);
	const rawEnd = clockMinutes(day.shiftEnd);
	const end = rawEnd <= start ? rawEnd + DAY_MINUTES : rawEnd;
	return Math.max(0, end - start - (day.shiftBreakMinutes ?? 0));
}

/**
 * Worked time past what the roster planned — DERIVED, and read-only everywhere it appears.
 *
 * There is no overtime field on this record and none may be added: `overtime_authorized` and the
 * five `approved_ot_*_hours` buckets were dropped in `drop_time_entry_overtime_approval`, and
 * `docs/architecture.md` §Gates records why. Overtime is priced by the payroll engine from actual
 * intervals against the effective schedule and the jurisdiction's bands. This number exists so an
 * operator can see that a day ran long; it is not an input to anything, and a control that let
 * somebody type it would be re-introducing the buckets by another name.
 *
 * Null when the day is unplanned or still open, because "beyond" needs both ends to mean anything.
 */
export function beyondScheduleMinutes(day: DayFacts): number | null {
	const planned = scheduledMinutes(day);
	if (planned == null || day.workedMinutes == null) return null;
	return day.workedMinutes - planned;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * EDITING ATTENDANCE: the same arithmetic the write path uses, so a form cannot offer a bad save.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** One interval as an editor holds it: instants, with the final end still possibly unset. */
const intervalDraftSchema = Schema.Struct({
	start: Schema.String,
	end: Schema.NullOr(Schema.String)
});
export type IntervalDraft = Schema.Schema.Type<typeof intervalDraftSchema>;

/**
 * The stored punches of a day, as the editor holds them.
 *
 * A stored bound reaches the client as ISO text. Both attendance surfaces open the same drawer, so
 * they read the day through the same exact record shape.
 */
export function intervalDrafts(
	intervals: readonly { readonly start: string; readonly end: string | null }[] | null | undefined
): readonly IntervalDraft[] {
	return (intervals ?? []).map((interval) => ({
		start: interval.start,
		end: interval.end
	}));
}

/**
 * Why a draft cannot be written, in the order `time_entries/+hooks.ts` refuses it.
 *
 * These are not new rules. Each one names a refusal `assertWorkedIntervals` already makes, and it is
 * restated here for one reason: a form that lets the operator press Save and then shows them the
 * hook's refusal has taught them nothing about which of the four things they did wrong, and it does
 * it after a round trip. The hook stays the authority — this is the same decision, taken early
 * enough to be useful.
 */
const attendanceDraftProblemSchema = Schema.Literals([
	'NO_INTERVALS',
	'OUT_OF_ORDER',
	'OPEN_NOT_LAST',
	'ENDS_BEFORE_IT_STARTS',
	'BREAK_NOT_SHORTER_THAN_WORK'
]);
type AttendanceDraftProblem = Schema.Schema.Type<typeof attendanceDraftProblemSchema>;

/** What one attendance draft can honestly say about itself, before the write path speaks. */
const attendanceDraftAssessmentSchema = Schema.Struct({
	/** Minutes across every interval that has both ends. Fractional if the data carries seconds. */
	closedMinutes: Schema.Number,
	hasOpenInterval: Schema.Boolean,
	/**
	 * The largest unpaid break these intervals can carry, or `null` when they can carry none.
	 *
	 * The hook refuses `unpaidBreak >= closedMinutes` — greater *or equal*, so a break exactly as
	 * long as the day is refused too, and the ceiling is the largest whole minute strictly below the
	 * worked total. `null` on an open day means "not yet decided" rather than "zero": nobody knows
	 * how long an unfinished day is, and the hook does not ask.
	 */
	maxBreakMinutes: Schema.NullOr(Schema.Number),
	/** The break after clamping, which is the value a save would actually send. */
	breakMinutes: Schema.Number,
	/** True when the requested break was reduced to fit. The sheet must SAY so, never do it quietly. */
	breakClamped: Schema.Boolean,
	/** The requested break, kept so the UI can report what it was before the clamp. */
	requestedBreakMinutes: Schema.Number,
	/** Net worked minutes, or null while a punch is open — the same contract `DayFacts` states. */
	workedMinutes: Schema.NullOr(Schema.Number),
	problem: Schema.NullOr(attendanceDraftProblemSchema)
});
type AttendanceDraftAssessment = Schema.Schema.Type<typeof attendanceDraftAssessmentSchema>;

/**
 * Assess an in-progress attendance edit against the rules the write path enforces.
 *
 * The clamp exists because of a defect found in the seed bank: four rows carried a 60-minute break
 * against nineteen to forty-one minutes of recorded attendance, which is exactly the shape a naive
 * editor produces — it shortens or stamps an interval and leaves `break_minutes` at the roster
 * code's scheduled hour. The hook then refuses the save with a sentence about unpaid breaks that
 * says nothing about the punch the operator was actually editing.
 *
 * So the ceiling is computed here, from the same numbers, and the caller is handed both the clamped
 * value and the fact that it clamped. It is deliberately NOT applied silently: a break that
 * collapses from sixty minutes to twelve is a statement about the day, and an operator who cannot
 * see it happen cannot tell that the punch, not the break, is the thing that is wrong.
 */
export function assessAttendanceDraft(
	intervals: readonly IntervalDraft[],
	requestedBreakMinutes: number
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

	/**
	 * The ceiling, matching `unpaidBreak >= closedMinutes` exactly.
	 *
	 * An integer total of N minutes admits at most N−1; a fractional one admits its floor, which is
	 * already strictly below it — so a half-minute day admits a break of zero, and nothing longer.
	 *
	 * `ceiling < 0` therefore means a day of exactly ZERO closed minutes, where even a zero break is
	 * not strictly shorter and the row is unsaveable however it is set. That is what
	 * `BREAK_NOT_SHORTER_THAN_WORK` reports, and it is a defensive arm rather than a reachable one
	 * today: reaching zero closed minutes needs an interval that does not end after it starts, which
	 * `ENDS_BEFORE_IT_STARTS` has already claimed by the time this runs.
	 */
	const ceiling = Number.isInteger(closedMinutes) ? closedMinutes - 1 : Math.floor(closedMinutes);
	const maxBreakMinutes = hasOpenInterval ? null : ceiling < 0 ? null : ceiling;

	const requested = Math.max(0, Math.trunc(requestedBreakMinutes));
	const breakMinutes =
		maxBreakMinutes == null
			? hasOpenInterval
				? requested
				: 0
			: Math.min(requested, maxBreakMinutes);
	const breakClamped = breakMinutes !== requested;
	if (problem == null && !hasOpenInterval && maxBreakMinutes == null && intervals.length > 0) {
		problem = 'BREAK_NOT_SHORTER_THAN_WORK';
	}

	return {
		closedMinutes,
		hasOpenInterval,
		maxBreakMinutes,
		breakMinutes,
		breakClamped,
		requestedBreakMinutes: requested,
		workedMinutes: hasOpenInterval ? null : Math.max(0, closedMinutes - breakMinutes),
		problem
	};
}

/** The catalog key explaining a refused draft, so the sheet and any future caller say one thing. */
export const ATTENDANCE_DRAFT_PROBLEM_KEY: Record<AttendanceDraftProblem, TenantI18nKeys> = {
	NO_INTERVALS: 'roster.day_sheet_problem_no_intervals',
	OUT_OF_ORDER: 'roster.day_sheet_problem_out_of_order',
	OPEN_NOT_LAST: 'roster.day_sheet_problem_open_not_last',
	ENDS_BEFORE_IT_STARTS: 'roster.day_sheet_problem_ends_before_start',
	BREAK_NOT_SHORTER_THAN_WORK: 'roster.day_sheet_problem_break_too_long'
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
	readonly labelKey: TenantI18nKeys;
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

/**
 * The evidence line's ink — two values, not four.
 *
 * A `✓` used to be green, a `!` red and an `⧗` amber, which spent three hues saying what the three
 * glyphs already say. The alarm belongs to the CELL, where `STATUS_PRESENTATION` puts an ATTENTION
 * fill behind the whole day; repeating it in the mark's ink would leave the cell amber on two
 * channels about one fact and, worse, invite `text-warning-foreground` — a near-black token meant
 * to sit on a SOLID `bg-warning`, which is illegible over the 25%-alpha tint the cell actually has.
 *
 * So the mark says only whether there is anything to read: the day's own ink when there is,
 * muted when there is not.
 */
export function actualMarkClass(day: DayFacts): string {
	if (day.attendanceState === 'OPEN' || day.status === 'ABSENT' || day.clockedIn) {
		return 'text-foreground';
	}
	return 'text-muted-foreground';
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
	{ readonly labelKey: TenantI18nKeys; readonly className: string; readonly mark: string }
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
function summarizeRosterMonth(facts: ReadonlyMap<string, DayFacts>): Map<DayStatus, number> {
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
const monthDraftingSchema = Schema.Literals(['NOT_DRAFTED', 'DRAFT', 'PUBLISHED']);
export type MonthDrafting = Schema.Schema.Type<typeof monthDraftingSchema>;

/** The progress table one month reports, keyed on the same statuses the board draws. */
const monthProgressSchema = Schema.Struct({
	drafting: monthDraftingSchema,
	/** People times days: the size of the month, and the denominator of everything below. */
	personDays: Schema.Number,
	rostered: Schema.Number,
	unrostered: Schema.Number,
	/** People with at least one active day that still has no shift. */
	peopleNeedingAssignment: Schema.Number,
	/**
	 * The things somebody has to act on now. Attendance faults always count; an unrostered day
	 * counts only in a published month, where it is a hole rather than unfinished work.
	 */
	exceptions: Schema.Array(Schema.Struct({ status: dayStatusSchema, count: Schema.Number }))
});
type MonthProgress = Schema.Schema.Type<typeof monthProgressSchema>;

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
