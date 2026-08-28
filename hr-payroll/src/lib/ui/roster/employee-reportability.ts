import type { DayFacts } from './roster-month.js';

type StringMembership = Readonly<{ has(value: string): boolean }>;

type EmployeeReportableDay = Pick<
	DayFacts,
	'employmentState' | 'date' | 'workDayId' | 'attendanceState' | 'leaveCode' | 'halfDayLeave'
>;

/**
 * Whether employee self-service may offer a missing-punch report for one day.
 *
 * An existing row is not itself a blocker: a roster-only person-day is exactly the row the report
 * must update. What blocks the report is existing attendance, a pending report, a settlement claim,
 * full-day leave, a future day, or a day outside the employment.
 *
 * A paid payroll window with no existing row is deliberately absent. Employees cannot read payroll
 * runs, so that server-side refusal must remain attempt-and-explain rather than a client-side guess.
 */
export function employeeMissingPunchReportable(
	day: EmployeeReportableDay,
	today: string,
	pendingDates: StringMembership,
	settledWorkDayIds: StringMembership
): boolean {
	if (day.employmentState !== 'ACTIVE') return false;
	if (day.date > today) return false;
	if (pendingDates.has(day.date)) return false;
	if (day.attendanceState !== null) return false;
	if (day.workDayId != null && settledWorkDayIds.has(day.workDayId)) return false;
	if (day.leaveCode != null && !day.halfDayLeave) return false;
	return true;
}
