/**
 * Resolve the schedule that payroll prices.
 *
 * A roster code is the single polymorphic scheduling vocabulary: WORK owns its clock window,
 * REST is the protected weekly rest, and OFF is another planned non-working day. Public holidays
 * are never stored as codes; they are overlaid from the published jurisdiction holiday calendar. A
 * `work_days` row that names a roster code overrides the employment's embedded work pattern for
 * that date; one that names none carries only attendance and leaves the pattern in force.
 */

import { Schema } from 'effect';
import { patternRosterCodeId } from '../../../lib/scheduling/work-pattern.js';
import {
	rosterCodeKind,
	workWindow,
	type WorkWindow
} from '../../../lib/scheduling/roster-code.js';
import type { Configuration, ShiftDefinition } from './configuration.js';
import { requiredDateKey, type IsoDate } from './dates.js';
import { coversDate } from './effective.js';
import { workPatternValueSchema } from '../../../datatypes/work_pattern/+definition.js';
import { RULE_DAY_TYPES } from '../../../lib/payroll/work-rules-values.js';
import type { HolidaySnapshot } from '../../../datatypes/holiday_snapshots/+definition.js';
import type { PayrollWindow } from './period.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type DayType = (typeof RULE_DAY_TYPES)[number] | 'OFF_DAY';

/** The overtime rules are stated for four day types; an off day is priced as an ordinary one. */
type RuleDayType = (typeof RULE_DAY_TYPES)[number];

export function ruleDayType(dayType: DayType): RuleDayType {
	return dayType === 'OFF_DAY' ? 'ORDINARY' : dayType;
}

/** A holiday row's kind is the day type it prices on; a SUBSTITUTE day prices as a public holiday. */
function holidayDayType(holiday: Pick<HolidaySnapshot, 'kind'>): RuleDayType {
	return holiday.kind === 'SPECIAL_HOLIDAY' ? 'SPECIAL_HOLIDAY' : 'PUBLIC_HOLIDAY';
}

type ScheduledShift = WorkWindow & {
	readonly id: string;
	readonly code: string;
};

export type ScheduledDay = {
	readonly date: IsoDate;
	readonly dayType: DayType;
	/** A WORK code projected for the date. REST and OFF codes intentionally have no shift. */
	readonly shift: ScheduledShift | null;
	/** The employee's ordinary scheduled start, used to ignore an early arrival. */
	readonly clampStart: string | null;
	/** Contracted average hours for one working day, derived from the embedded pattern. */
	readonly normalHours: number;
	/**
	 * Whether the roster made this the person's weekly rest day, whatever holiday precedence then
	 * called it: a holiday that falls on the rest day is priced by a compounded band (PH 260%,
	 * VN 300%) that reads `rest_day` beside `day_type`.
	 */
	readonly restDay: boolean;
	/** The rest day the statute forbids work on (the REST code's `statutory`), whatever the holiday made it. */
	readonly statutoryRest: boolean;
	/** Whether the roster left the day unassigned (OFF) before any holiday was overlaid on it. */
	readonly offDay: boolean;
	/**
	 * The holiday the person observes on this date, where the day prices as one: the calendar row's
	 * own name, or — under SUBSTITUTE — the rest-day holiday carried here and the date it fell on.
	 * Null on every other day. Pricing reads `dayType`; this names the day for a surface.
	 */
	readonly observedHoliday: { readonly name: string; readonly from: IsoDate | null } | null;
};

type WeeklyHoursTerms = {
	readonly ordinary_hours_per_week: number;
	readonly working_days_per_week: number;
};

/** Kept as a derived payroll-rate shape; these are no longer independent employment fields. */
export function normalDailyHours(terms: WeeklyHoursTerms): number {
	const days = decodeNumber(terms.working_days_per_week);
	if (!(days > 0)) throw new Error('Derived working days per week must be greater than zero.');
	return decodeNumber(terms.ordinary_hours_per_week) / days;
}

type ScheduleTerms = {
	readonly work_pattern: Schema.Schema.Type<typeof workPatternValueSchema> | null;
	/** The pattern row's effective start, the day its cycle counts from. */
	readonly pattern_anchor: string | null;
	readonly normal_daily_hours: number;
	/**
	 * The most a rostered shift's own length counts as the normal day: the statute's normal day
	 * (MY s.60A(1): 8, or 9 under the 45-hour proviso), and the contract's stated day where it
	 * states one. A shift longer than it is a normal day plus overtime; a shorter one is its own
	 * normal day. Absent is `normal_daily_hours`.
	 */
	readonly shift_day_hours?: number;
};

/**
 * The planned half of a `work_days` row, which is the only half a schedule reads.
 *
 * `shift_definition_id` is nullable and its absence is the presence test: a day carrying only
 * attendance names no roster code, and falls back to whatever the employment's work pattern
 * projects for it exactly as a day with no row at all does.
 */
type PlannedDay = {
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

function scheduledCode(
	code: ShiftDefinition,
	date: IsoDate
): {
	readonly kind: 'WORK' | 'REST' | 'OFF';
	readonly shift: ScheduledShift | null;
	/** A REST code marked the statutory rest day (TW 例假). */
	readonly statutoryRest: boolean;
} {
	if (!coversDate(code.effective_range, date))
		throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
	const kind = rosterCodeKind(code.variant);
	const window = workWindow(code.variant);
	const variant = code.variant as { kind: string; statutory?: boolean };
	return {
		kind,
		shift: window == null ? null : { id: code.id, code: code.code, ...window },
		statutoryRest: variant.kind === 'REST' && variant.statutory === true
	};
}

function dayTypeFor(kind: 'WORK' | 'REST' | 'OFF'): Exclude<DayType, 'PUBLIC_HOLIDAY'> {
	switch (kind) {
		case 'WORK':
			return 'ORDINARY';
		case 'REST':
			return 'REST_DAY';
		case 'OFF':
			return 'OFF_DAY';
	}
}

/** What `resolveSchedule` needs: the window, the days, the terms read per day, and the plans. */
type ResolveScheduleOptions = {
	readonly window: PayrollWindow['salary'];
	readonly dates: readonly IsoDate[];
	readonly terms: (date: IsoDate) => ScheduleTerms;
	readonly workDays: readonly PlannedDay[];
	/** The cycles a roster of record covers; a day inside one reads its row before the pattern. */
	readonly rosters?: readonly { readonly start: IsoDate; readonly end: IsoDate }[];
	readonly configuration: Pick<Configuration, 'holidays' | 'shiftById' | 'holidayRestPrecedence'>;
};

/** Resolve every day of a window for one employment. */
export function resolveSchedule(options: ResolveScheduleOptions): Map<IsoDate, ScheduledDay> {
	const plannedByDate = new Map<IsoDate, PlannedDay>();
	for (const day of options.workDays) {
		plannedByDate.set(requiredDateKey(day.work_date, 'work_days.work_date'), day);
	}

	const codeFor = (id: string, date: IsoDate): ShiftDefinition => {
		const code = options.configuration.shiftById.get(id);
		if (!code)
			throw new Error(`Schedule on ${date} names roster code ${id}, which does not exist.`);
		return code;
	};

	/**
	 * The contractual kind on one date: the explicit plan when the row carries one, else the
	 * pattern projection — the same precedence the day itself resolves. Null where neither names
	 * a code or the date sits outside this contract.
	 */
	const baseKindOn = (date: IsoDate): 'WORK' | 'REST' | 'OFF' | null => {
		try {
			const planned = plannedByDate.get(date);
			const term = options.terms(date);
			const projectedId = patternRosterCodeId(term.work_pattern, date, term.pattern_anchor);
			const codeId = planned?.shift_definition_id ?? projectedId;
			return codeId == null ? null : scheduledCode(codeFor(codeId, date), date).kind;
		} catch {
			return null;
		}
	};

	let clampStart: string | null = null;
	const pending: {
		date: IsoDate;
		dayType: DayType;
		shift: ScheduledShift | null;
		normalHours: number;
		restDay: boolean;
		statutoryRest: boolean;
		offDay: boolean;
		observedHoliday: ScheduledDay['observedHoliday'];
	}[] = [];
	const precedence = options.configuration.holidayRestPrecedence;
	if (precedence !== 'REST_DAY' && precedence !== 'PUBLIC_HOLIDAY' && precedence !== 'SUBSTITUTE')
		throw new Error('The Work rules must specify public-holiday/rest-day precedence.');
	/** Under SUBSTITUTE: holidays that fell on a rest day, waiting for the next working day. */
	const carried: { dayType: RuleDayType; name: string; from: IsoDate }[] = [];
	/**
	 * The rest-day holidays the calendar already substitutes itself, by the date they came from.
	 *
	 * A gazette usually publishes the substitute as its own dated row — Malaysia, Singapore, Taiwan
	 * and Vietnam all seed one per rest-day holiday, each naming its `replaces`. Carrying such
	 * a holiday forward as well observes it twice: the seeded substitute prices as a holiday from
	 * its own row without consuming the carry, and the carry then lands on the next ordinary day
	 * after that. Fourteen seeded rows across the bank, so fourteen extra paid holidays a year.
	 *
	 * The carry is for the other shape — a calendar that states only the replaced date and leaves
	 * the observation to the rule.
	 */
	const substitutedFrom = new Set<IsoDate>();
	for (const holiday of options.configuration.holidays.values())
		if (holiday.replaces != null) substitutedFrom.add(holiday.replaces);

	for (const date of options.dates) {
		const terms = options.terms(date);
		const planned = plannedByDate.get(date);
		const patternCodeId = patternRosterCodeId(terms.work_pattern, date, terms.pattern_anchor);
		const assignmentCodeId = planned?.shift_definition_id ?? patternCodeId;
		// A ROSTERED employment has no generated assignment. An absent monthly entry is simply OFF;
		// publication validation is responsible for enforcing any guaranteed load.
		const assignmentCode =
			assignmentCodeId == null ? null : scheduledCode(codeFor(assignmentCodeId, date), date);
		const patternCode =
			patternCodeId == null ? null : scheduledCode(codeFor(patternCodeId, date), date);
		// For a patterned employment the pattern remains the contractual baseline. A monthly WORK
		// assignment on a patterned REST/OFF day therefore carries a real shift window while retaining
		// the protected day type: scheduled overtime is derived from that difference, not tagged.
		// A roster of record outranks the pattern: inside its cycle the row is the contract.
		const rostered = (options.rosters ?? []).some(
			(roster) => roster.start <= date && date <= roster.end
		);
		const dayCode = rostered ? (assignmentCode ?? patternCode) : (patternCode ?? assignmentCode);
		const baseDayType = dayCode == null ? 'OFF_DAY' : dayTypeFor(dayCode.kind);
		const holidayRow = options.configuration.holidays.get(date);
		// A holiday scoped to staff who were off on the replaced date does not apply to someone
		// whose roster had that date as WORK: the holiday itself was their day off, and the
		// observed day is an ordinary working day for them.
		const holiday =
			holidayRow?.given_to === 'ONLY_IF_OFF_ON_REPLACED_DATE' &&
			holidayRow.replaces != null &&
			baseKindOn(holidayRow.replaces) === 'WORK'
				? undefined
				: holidayRow;
		// Observed dates come only from the jurisdiction calendar. The pricing rule resolves overlap.
		let dayType: DayType = holiday ? holidayDayType(holiday) : baseDayType;
		let observedHoliday: ScheduledDay['observedHoliday'] = holiday
			? { name: holiday.name, from: null }
			: null;
		if (holiday && baseDayType === 'REST_DAY') {
			// SUBSTITUTE: the rest day stays a rest day and the holiday is observed on the next
			// working day of the window; one that falls past the window is nobody's to observe here.
			if (precedence === 'SUBSTITUTE') {
				dayType = 'REST_DAY';
				observedHoliday = null;
				if (!substitutedFrom.has(date))
					carried.push({ dayType: holidayDayType(holiday), name: holiday.name, from: date });
			} else if (precedence === 'REST_DAY') {
				dayType = precedence;
				observedHoliday = null;
			} else
				// The holiday's own kind wins over the rest day: a special day stays special (and
				// `rest_day` says it was the rest day, for the compounded band).
				dayType = holidayDayType(holiday);
		} else if (!holiday && baseDayType === 'ORDINARY' && carried.length > 0) {
			const carry = carried.shift()!;
			dayType = carry.dayType;
			observedHoliday = { name: carry.name, from: carry.from };
		}
		if (clampStart == null && baseDayType === 'ORDINARY' && assignmentCode?.shift)
			clampStart = assignmentCode.shift.start_time;
		pending.push({
			date,
			dayType,
			shift: assignmentCode?.shift ?? null,
			// A rostered shift shorter than the normal day is that day's normal day: overtime is
			// the hours beyond the normal hours of work, and a short day's are its own.
			normalHours:
				assignmentCode?.shift != null
					? Math.min(
							terms.shift_day_hours ?? terms.normal_daily_hours,
							assignmentCode.shift.paid_minutes / 60
						)
					: terms.normal_daily_hours,
			restDay: baseDayType === 'REST_DAY',
			statutoryRest: baseDayType === 'REST_DAY' && dayCode?.statutoryRest === true,
			offDay: baseDayType === 'OFF_DAY',
			observedHoliday
		});
	}

	const resolved = new Map<IsoDate, ScheduledDay>();
	for (const day of pending) {
		resolved.set(day.date, {
			date: day.date,
			dayType: day.dayType,
			shift: day.shift,
			clampStart: day.shift?.start_time ?? clampStart,
			normalHours: day.normalHours,
			restDay: day.restDay,
			statutoryRest: day.statutoryRest,
			offDay: day.offDay,
			observedHoliday: day.observedHoliday
		});
	}
	return resolved;
}
