/**
 * Resolve the schedule that payroll prices.
 *
 * A roster code is the single polymorphic scheduling vocabulary: WORK owns its clock window,
 * REST is the protected weekly rest, and OFF is another planned non-working day. Public holidays
 * are never stored as codes; they are overlaid from the observed company holiday calendar. A
 * monthly roster entry overrides the employment's embedded work pattern for that date.
 */

import { patternRosterCodeId } from '../../../lib/scheduling/work-pattern.js';
import {
	rosterCodeKind,
	workWindow,
	type WorkWindow
} from '../../../lib/scheduling/roster-code.js';
import type { Configuration, ShiftDefinition } from './configuration.js';
import { dateKey, requiredDateKey, type IsoDate } from './dates.js';
import { coversDate } from './effective.js';
import type { WorkPattern } from '../../../custom-types/work_pattern/+definition.js';

export type DayType = 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'OFF_DAY';

/** The overtime rules are stated for three day types; an off day is priced as an ordinary one. */
export type RuleDayType = 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY';

export function ruleDayType(dayType: DayType): RuleDayType {
	return dayType === 'OFF_DAY' ? 'ORDINARY' : dayType;
}

export type ScheduledShift = WorkWindow & {
	readonly norbital_id: string;
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
};

export interface WeeklyHoursTerms {
	readonly ordinary_hours_per_week: number;
	readonly working_days_per_week: number;
}

/** Kept as a derived payroll-rate shape; these are no longer independent employment fields. */
export function normalDailyHours(terms: WeeklyHoursTerms): number {
	const days = Number(terms.working_days_per_week);
	if (!(days > 0)) throw new Error('Derived working days per week must be greater than zero.');
	return Number(terms.ordinary_hours_per_week) / days;
}

export type ScheduleTerms = {
	readonly work_pattern: WorkPattern;
	readonly normal_daily_hours: number;
};

type RosterEntry = {
	readonly work_date: string | Date;
	readonly shift_definition_id: string;
};

function scheduledCode(
	code: ShiftDefinition,
	date: IsoDate
): { readonly kind: 'WORK' | 'REST' | 'OFF'; readonly shift: ScheduledShift | null } {
	if (!coversDate(code.effective_range, date))
		throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
	const kind = rosterCodeKind(code.variant);
	const window = workWindow(code.variant);
	return {
		kind,
		shift: window == null ? null : { norbital_id: code.norbital_id, code: code.code, ...window }
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

/** Resolve every day of a window for one employment. */
export function resolveSchedule(options: {
	readonly window: { readonly start: IsoDate; readonly end: IsoDate };
	readonly dates: readonly IsoDate[];
	readonly terms: (date: IsoDate) => ScheduleTerms;
	readonly rosterEntries: readonly RosterEntry[];
	readonly configuration: Pick<Configuration, 'holidays' | 'shiftById'>;
}): Map<IsoDate, ScheduledDay> {
	const rosterByDate = new Map<IsoDate, RosterEntry>();
	for (const entry of options.rosterEntries) {
		rosterByDate.set(requiredDateKey(entry.work_date, 'roster_entries.work_date'), entry);
	}

	const codeFor = (id: string, date: IsoDate): ShiftDefinition => {
		const code = options.configuration.shiftById.get(id);
		if (!code)
			throw new Error(`Schedule on ${date} names roster code ${id}, which does not exist.`);
		return code;
	};

	let clampStart: string | null = null;
	const pending: {
		date: IsoDate;
		baseDayType: Exclude<DayType, 'PUBLIC_HOLIDAY'>;
		dayType: DayType;
		shift: ScheduledShift | null;
		normalHours: number;
	}[] = [];

	for (const date of options.dates) {
		const terms = options.terms(date);
		const roster = rosterByDate.get(date);
		const patternCodeId = patternRosterCodeId(terms.work_pattern, date);
		const assignmentCodeId = roster?.shift_definition_id ?? patternCodeId;
		// A ROSTERED employment has no generated assignment. An absent monthly entry is simply OFF;
		// publication validation is responsible for enforcing any guaranteed load.
		const assignmentCode =
			assignmentCodeId == null ? null : scheduledCode(codeFor(assignmentCodeId, date), date);
		const patternCode =
			patternCodeId == null ? null : scheduledCode(codeFor(patternCodeId, date), date);
		// For a patterned employment the pattern remains the contractual baseline. A monthly WORK
		// assignment on a patterned REST/OFF day therefore carries a real shift window while retaining
		// the protected day type: scheduled overtime is derived from that difference, not tagged.
		const dayCode = patternCode ?? assignmentCode;
		const baseDayType = dayCode == null ? 'OFF_DAY' : dayTypeFor(dayCode.kind);
		const holiday = options.configuration.holidays.get(date);
		// A holiday on a statutory REST day is substituted below; the original remains REST_DAY.
		const dayType: DayType = holiday && baseDayType !== 'REST_DAY' ? 'PUBLIC_HOLIDAY' : baseDayType;
		if (clampStart == null && baseDayType === 'ORDINARY' && assignmentCode?.shift)
			clampStart = assignmentCode.shift.start_time;
		pending.push({
			date,
			baseDayType,
			dayType,
			shift: assignmentCode?.shift ?? null,
			normalHours: terms.normal_daily_hours
		});
	}

	/* EA 1955 s.60D(1): a holiday on the employee's rest day moves to the next working day. */
	const explicitlySubstituted = new Set(
		[...options.configuration.holidays.values()]
			.map((holiday) => dateKey(holiday.substitutes_date))
			.filter((date): date is IsoDate => date != null)
	);
	const substituteDates = new Set<IsoDate>();
	for (let index = 0; index < pending.length; index += 1) {
		const holidayDay = pending[index]!;
		if (
			!options.configuration.holidays.has(holidayDay.date) ||
			holidayDay.baseDayType !== 'REST_DAY' ||
			explicitlySubstituted.has(holidayDay.date)
		)
			continue;
		for (let candidateIndex = index + 1; candidateIndex < pending.length; candidateIndex += 1) {
			const candidate = pending[candidateIndex]!;
			if (candidate.baseDayType !== 'ORDINARY') continue;
			if (options.configuration.holidays.has(candidate.date) || substituteDates.has(candidate.date))
				continue;
			substituteDates.add(candidate.date);
			candidate.dayType = 'PUBLIC_HOLIDAY';
			break;
		}
	}

	const resolved = new Map<IsoDate, ScheduledDay>();
	for (const day of pending) {
		resolved.set(day.date, {
			date: day.date,
			dayType: day.dayType,
			shift: day.shift,
			clampStart: day.shift?.start_time ?? clampStart,
			normalHours: day.normalHours
		});
	}
	return resolved;
}
