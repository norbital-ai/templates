import type { ResolvedEmployment } from '../../../lib/employment-contract.js';
/**
 * Which run an employment settles in, and which days it covers — where it differs from the
 * company-wide window of `period.ts`:
 *
 * 1. A joiner after the window closed is deferred and paid as arrears in the next run.
 * 2. A leaver between the window's close and the period end settles in the final run, its window
 *    extended to the exit date.
 * 3. An unpaid day inside a qualifying absence settles in its own calendar month.
 *
 * Every unpaid day is consumed exactly once: by its month's run inside an absence, otherwise by the
 * run whose window contains it.
 */

import {
	addDays,
	dayOfMonth,
	monthBounds,
	monthDay,
	periodMonth,
	shiftPeriod,
	type IsoDate
} from './dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import { attendanceWindow, type PayrollWindow } from './period.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import { decodeNumber } from '../../wire.js';

export type EmploymentDates = {
	readonly hire: string;
	readonly exit: string | null;
};

type DayRange = {
	readonly start: string;
	readonly end: string;
};

export type EmploymentSettlement = {
	/** Whether this run produces a payslip for the employment at all. */
	readonly runs: boolean;
	/** The days of the pay period the employment covers, or `null` when it covers none. */
	readonly employedDays: DayRange | null;
	/** The days recurring wages cover; may extend past a leaver's exit by company policy. */
	readonly wageDays: DayRange | null;
	/** The attendance days this run reads for this employment — the tail of a leaver included. */
	readonly attendance: DayRange;
	/**
	 * Set when the employment's own period is being skipped. `runs` is false whenever this is set,
	 * and its wages are not paid in this period. Statutory coverage is still measured where the
	 * jurisdiction requires a joining-month assessment.
	 */
	readonly deferral: {
		readonly coversPeriod: string;
		readonly paidInPeriod: string;
		readonly days: DayRange;
	} | null;
	/**
	 * Set when this run is paying a period an earlier one skipped.
	 *
	 * **The arrears is derived here, not carried from there.** What someone was owed for the month
	 * they joined is a fact about their contract and their start date, not about whether a run
	 * happened — a customer who onboards in February and never builds January must still pay the
	 * January days, and a system that answered "nothing was carried forward, so nothing is owed"
	 * would underpay in silence. Every input needed is on this run's own bundle.
	 */
	readonly arrearsFor: {
		readonly period: string;
		readonly salary: DayRange;
		readonly attendance: DayRange;
		readonly days: DayRange;
	} | null;
};

/** The days of `period` an employment covers, or `null` when it covers none. */
function employedWithin(
	dates: EmploymentDates,
	period: { start: IsoDate; end: IsoDate }
): { start: IsoDate; end: IsoDate } | null {
	const start = dates.hire > period.start ? dates.hire : period.start;
	const end = dates.exit != null && dates.exit < period.end ? dates.exit : period.end;
	return start > end ? null : { start, end };
}

/**
 * Whether an employment starting on `hire` is deferred out of the period whose attendance window
 * ends on `attendanceEnd`.
 *
 * The test is the window, not the cutoff day: "joined after the 20th" is the customer's phrasing of
 * "joined after the last day this run can see", and stating it that way is what keeps the rule
 * correct when the cutoff moves and true in a month with 28 days.
 */
function startsAfterWindow(
	hire: IsoDate,
	period: { start: IsoDate; end: IsoDate },
	attendanceEnd: IsoDate
): boolean {
	return hire >= period.start && hire <= period.end && hire > attendanceEnd;
}

/**
 * Resolve one employment against one run.
 *
 * `window` is the company's; everything returned is this employment's.
 */
export function resolveEmploymentSettlement(options: {
	readonly dates: EmploymentDates;
	readonly window: PayrollWindow;
}): EmploymentSettlement {
	const { dates, window } = options;
	const employedDays = employedWithin(dates, window.salary);

	// Someone who joins and leaves inside the same period has no next run to be deferred into, and
	// the final-pay rule is explicit that nothing may be pushed past it. Rule 2 wins over rule 1
	// wherever they meet, which is the only ordering that never strands a wage. Recurring wages
	// cover the employment days only: a leaver is prorated to the exit date.
	const endsHere = dates.exit != null && dates.exit <= window.salary.end;
	const wageDays = employedDays;

	// ── 1. the joining period, skipped ─────────────────────────────────────────────────────────
	if (!endsHere && startsAfterWindow(dates.hire, window.salary, window.attendance.end)) {
		const days = employedDays;
		return {
			runs: false,
			employedDays,
			wageDays,
			attendance: window.attendance,
			deferral:
				days == null
					? null
					: {
							coversPeriod: window.period,
							paidInPeriod: shiftPeriod(window.period, 1),
							days
						},
			arrearsFor: null
		};
	}

	// ── the period after a skipped one, paying what it owes ────────────────────────────────────
	let arrearsFor: EmploymentSettlement['arrearsFor'] = null;
	{
		const previousPeriod = shiftPeriod(window.period, -1);
		const previousBounds = monthBounds(periodMonth(previousPeriod));
		const previousEnd = addDays(window.attendance.start, -1);
		if (startsAfterWindow(dates.hire, previousBounds, previousEnd)) {
			const days = employedWithin(dates, previousBounds);
			if (days != null)
				arrearsFor = {
					period: previousPeriod,
					salary: previousBounds,
					// The deferred period's own attendance window — which, by the very test that
					// deferred it, this employment has no day inside. That is not a technicality: the
					// days they *did* work at the end of that month fall in **this** run's window and
					// are already being paid here, so reading them again for the arrears would pay the
					// same overtime twice. It is also why the workbook's `back_pay_ot` is empty for
					// every late joiner in the source.
					attendance: attendanceWindow(previousPeriod, dayOfMonth(window.attendance.start)),
					days
				};
		}
	}

	// ── 2. the final period, extended to the exit date ─────────────────────────────────────────
	const endsInTail =
		dates.exit != null && dates.exit > window.attendance.end && dates.exit <= window.salary.end;
	const attendance = endsInTail
		? { start: window.attendance.start, end: dates.exit! }
		: window.attendance;

	return {
		runs: employedDays != null,
		employedDays,
		wageDays,
		attendance,
		deferral: null,
		arrearsFor
	};
}

/** Narrow a stored stint range, failing loudly on a row that has no start. */
export function employmentDates(
	employment: Pick<ResolvedEmployment, 'employee_number' | 'id' | 'effective_range'>
): EmploymentDates {
	const start = employment.effective_range?.start;
	const hire = dateKey(start);
	if (hire === '')
		throw new Error(
			`Employment ${employment.employee_number ?? employment.id ?? '(unknown)'} has no service start.`
		);
	const end = employment.effective_range?.end;
	return { hire, exit: dateKey(end) || null };
}
