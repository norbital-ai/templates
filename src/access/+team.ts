import { team } from '@norbital-ai/bolt';

/**
 * Which policies each team holds. What a team may do is this file, compiled into the release; who is on a team is
 * an operational fact (team and assignment rows, seeded from the bank), bound here by name, case-insensitively. A
 * team row whose name is absent here holds nothing.
 *
 * Each team holds one policy that states its complete authority (each rank re-composes the rank beneath it):
 *
 *   Employee → Supervisor → L1 Manager → Senior Management        (rank)
 *                    HQ Payroll HR → HR Manager                   (payroll authority)
 *
 * Approval steps name these teams; a misspelt approver is a type error.
 */
export default team({
	/** Rank 1. Self-service: a person's own record, their own time, their own requests. */
	Employee: ['employee'],
	/** Rank 2. Their own, plus their reports' attendance and leave. */
	Supervisor: ['supervisor'],
	/** Rank 3, and the team an approval flow means by "the direct manager". */
	'L1 Manager': ['manager'],
	/** Rank 4. Reads payroll; runs it without review. */
	'Senior Management': ['senior_management'],
	/** Owns the shift: the roster and the clock, and the late-arrival reminders. */
	'Production Manager': ['supervisor'],
	/** Payroll authority 1 of 2: a controller's run is held for the HR Manager. */
	'HQ Payroll HR': ['hr_controller'],
	/** Payroll authority 2 of 2: runs, re-runs, pays and deletes payroll. */
	'HR Manager': ['hr_manager'],
	/** A manager with HR-controller authority; `hr_controller` already carries every `manager` grant. */
	'Manager (HR Controller)': ['hr_controller'],
	/** The attendance-kiosk device account: the attendance kiosk, punches and pending enrolments only. */
	'Attendance Kiosk': ['kiosk']
});
