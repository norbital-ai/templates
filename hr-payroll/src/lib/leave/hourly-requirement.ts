import type { WorkPattern } from '../datatypes/work_pattern.js';
import { patternDaysPerWeek, patternWorkload } from '../scheduling/work-pattern.js';
import type { RosterCodeLike } from '../scheduling/roster-code.js';
import { refuse } from '../refuse.js';
import type { LeaveEntitlement } from '../datatypes/leave_entitlement.js';

type HourlyTerm = {
	readonly employment_type: string;
	readonly ordinary_hours_per_week: number | null;
	readonly comparable_full_time_presence?: string | null;
	readonly comparable_full_time_daily_hours?: number | null;
	readonly comparable_full_time_weekly_hours?: number | null;
};

type HourlyRule = Pick<LeaveEntitlement, 'requires_hourly_for_part_time' | 'part_time_hours'>;

/** The row's stored part-time hours; an hourly row without them cannot classify anyone. */
function partTimeHours(rule: HourlyRule) {
	if (rule.part_time_hours == null)
		refuse(
			'This leave is granted in hours to part-time employees, but its catalogue row states no part-time hours.'
		);
	return rule.part_time_hours;
}

function partTimeWeek(
	belowHours: number,
	term: HourlyTerm,
	pattern: WorkPattern | null,
	rosterCodes: ReadonlyMap<string, RosterCodeLike>
): number {
	const hours =
		term.ordinary_hours_per_week ??
		(pattern == null
			? 0
			: (patternWorkload(pattern, rosterCodes)?.average_weekly_paid_minutes ?? 0) / 60);
	if (!(hours > 0))
		refuse(
			'This leave is granted in hours to part-time employees, so the employment needs contracted weekly working hours.'
		);
	if ((term.employment_type === 'PART_TIME') !== hours < belowHours)
		refuse('Employment part-time status conflicts with contracted weekly hours.');
	return hours;
}

/** A comparable full-time worker supplies both hours; the row's stated fallback requires ABSENT. */
export function hourlyLeaveBasis(
	rule: HourlyRule,
	term: HourlyTerm,
	pattern: WorkPattern | null,
	rosterCodes: ReadonlyMap<string, RosterCodeLike>
): { readonly grantHoursPerDay: number; readonly normalDailyHours: number } | null {
	if (rule.requires_hourly_for_part_time !== true) return null;
	const stated = partTimeHours(rule);
	const weeklyHours = partTimeWeek(stated.part_time_below_hours, term, pattern, rosterCodes);
	if (weeklyHours >= stated.part_time_below_hours) return null;
	const daysPerWeek = pattern == null ? 0 : patternDaysPerWeek(pattern, rosterCodes);
	if (!(daysPerWeek > 0)) refuse('Part-time leave needs a dated working-day pattern.');
	const presence = term.comparable_full_time_presence;
	if (presence !== 'PRESENT' && presence !== 'ABSENT')
		refuse('Part-time leave needs the similar full-time employee declaration.');
	if (
		presence === 'ABSENT' &&
		(term.comparable_full_time_weekly_hours != null ||
			term.comparable_full_time_daily_hours != null)
	)
		refuse('An absent full-time comparator cannot also state comparator hours.');
	const fullWeek =
		presence === 'ABSENT'
			? stated.comparator_weekly_hours
			: (term.comparable_full_time_weekly_hours ?? 0);
	const fullDay =
		presence === 'ABSENT'
			? stated.comparator_daily_hours
			: (term.comparable_full_time_daily_hours ?? 0);
	if (!(fullWeek > 0 && fullDay > 0))
		refuse('Part-time leave needs the similar full-time employee’s daily and weekly hours.');
	if (fullWeek < stated.part_time_below_hours)
		refuse('Part-time leave needs a comparator contracted for full-time weekly hours.');
	return {
		grantHoursPerDay: (weeklyHours / fullWeek) * fullDay,
		normalDailyHours: weeklyHours / daysPerWeek
	};
}

/** A declared hourly leave rule cannot pass through the day-based balance and pay ledger. */
export function unsupportedHourlyLeave(
	rule: HourlyRule,
	term: HourlyTerm,
	pattern: WorkPattern | null,
	rosterCodes: ReadonlyMap<string, RosterCodeLike>
): boolean {
	if (rule.requires_hourly_for_part_time !== true) return false;
	const below = partTimeHours(rule).part_time_below_hours;
	return partTimeWeek(below, term, pattern, rosterCodes) < below;
}
