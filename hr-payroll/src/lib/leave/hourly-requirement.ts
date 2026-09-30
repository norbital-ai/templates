import type { WorkPattern } from '../datatypes/work_pattern.js';
import { patternDaysPerWeek, patternWorkload } from '../scheduling/work-pattern.js';
import type { RosterCodeLike } from '../scheduling/roster-code.js';
import { refuse } from '../refuse.js';

type HourlyTerm = {
	readonly employment_type: string;
	readonly ordinary_hours_per_week: number | null;
	readonly comparable_full_time_presence?: string | null;
	readonly comparable_full_time_daily_hours?: number | null;
	readonly comparable_full_time_weekly_hours?: number | null;
};

function partTimeWeek(
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
	if ((term.employment_type === 'PART_TIME') !== hours < 35)
		refuse('Employment part-time status conflicts with contracted weekly hours.');
	return hours;
}

/** A comparable full-time worker supplies both hours; the statutory fallback requires ABSENT. */
export function hourlyLeaveBasis(
	rule: { readonly requires_hourly_for_part_time?: boolean | null },
	term: HourlyTerm,
	pattern: WorkPattern | null,
	rosterCodes: ReadonlyMap<string, RosterCodeLike>
): { readonly grantHoursPerDay: number; readonly normalDailyHours: number } | null {
	if (rule.requires_hourly_for_part_time !== true) return null;
	const weeklyHours = partTimeWeek(term, pattern, rosterCodes);
	if (weeklyHours >= 35) return null;
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
	const fullWeek = presence === 'ABSENT' ? 44 : (term.comparable_full_time_weekly_hours ?? 0);
	const fullDay = presence === 'ABSENT' ? 8 : (term.comparable_full_time_daily_hours ?? 0);
	if (!(fullWeek > 0 && fullDay > 0))
		refuse('Part-time leave needs the similar full-time employee’s daily and weekly hours.');
	if (fullWeek < 35)
		refuse('Part-time leave needs a comparator contracted for full-time weekly hours.');
	return {
		grantHoursPerDay: (weeklyHours / fullWeek) * fullDay,
		normalDailyHours: weeklyHours / daysPerWeek
	};
}

/** A declared hourly leave rule cannot pass through the day-based balance and pay ledger. */
export function unsupportedHourlyLeave(
	rule: { readonly requires_hourly_for_part_time?: boolean | null },
	term: HourlyTerm,
	pattern: WorkPattern | null,
	rosterCodes: ReadonlyMap<string, RosterCodeLike>
): boolean {
	if (rule.requires_hourly_for_part_time !== true) return false;
	return partTimeWeek(term, pattern, rosterCodes) < 35;
}
