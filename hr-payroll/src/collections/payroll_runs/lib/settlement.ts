import type { ResolvedEmployment } from '../../../lib/employment-contract.js';
/**
 * Which run an **employment** settles in, and which days that run covers for it.
 *
 * `period.ts` answers the company-wide question — the calendar month wages belong to, and the
 * attendance window those wages cover. It is the same answer for everyone. This module answers the
 * per-person question, and there are exactly three cases where the two differ:
 *
 * ```
 *                 Feb                                Mar
 *   ──────┼─────────────┼───────────────┼──────────────┼────►
 *         1            21              1             21
 *              └──── attendance ───────┘
 *                     21 Jan → 20 Feb        pay period 2026-02
 *
 *   joiner 23 Feb   ▓▓▓▓▓▓          ← starts after the window closed:
 *                                     no day of it is measurable in February
 *   leaver 27 Feb          ▓▓▓▓▓▓▓  ← ends after the window closed:
 *                                     no later run will ever look at these days
 * ```
 *
 * 1. **A late joiner.** An employment beginning after the attendance window has closed did not work
 *    one day the run can measure. Paying a stub for it anyway states an attendance the run never
 *    read; the customer's rule is to skip the joining period and pay it as arrears in the next one.
 * 2. **A leaver in the tail.** An employment ending between the window's close and the period end
 *    has days that fall inside the *next* period's window — and there is no next run for that
 *    person. Their absence would go unrecovered and their clocks unread. The final run's window is
 *    extended to the exit date so nothing is left behind.
 * 3. **A leave of absence longer than a window.** Unpaid days settle in the calendar month they
 *    fall in rather than the month whose window carries them, so a leave beginning on the 15th is
 *    felt in that month's pay.
 *
 * **Every unpaid day is consumed exactly once.** A day inside a qualifying absence is only ever
 * taken by the run for its own calendar month; a day outside one is only ever taken by the run
 * whose attendance window contains it. The two sets are disjoint by construction and together they
 * are every day, which is the property that makes this a cutoff rule rather than an adjustment.
 *
 * Nothing here names a country, a nationality or a component. The three rules are the engine's
 * only behaviour: a late joiner's period is deferred and paid as arrears in their first run, a
 * leaver settles in their final period with wages prorated to the exit date, and every unpaid day
 * settles in the run whose attendance window contains it, prorated by the jurisdiction's basis.
 */

import { Schema } from 'effect';
import {
	addDays,
	dateKey,
	dayOfMonth,
	monthBounds,
	monthDay,
	periodMonth,
	shiftPeriod,
	type IsoDate
} from './dates.js';
import { attendanceWindow, type PayrollWindow } from './period.js';
import type { WorkspaceRow } from '../$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

const EmploymentDatesSchema = Schema.Struct({
	hire: Schema.String,
	exit: Schema.NullOr(Schema.String)
});
type EmploymentDates = Schema.Schema.Type<typeof EmploymentDatesSchema>;

const dayRangeSchema = Schema.Struct({ start: Schema.String, end: Schema.String });
const EmploymentSettlementSchema = Schema.Struct({
	/** Whether this run produces a payslip for the employment at all. */
	runs: Schema.Boolean,
	/** The days of the pay period the employment covers, or `null` when it covers none. */
	employedDays: Schema.NullOr(dayRangeSchema),
	/** The days recurring wages cover; may extend past a leaver's exit by company policy. */
	wageDays: Schema.NullOr(dayRangeSchema),
	/** The attendance days this run reads for this employment — the tail of a leaver included. */
	attendance: dayRangeSchema,
	/**
	 * Set when the employment's own period is being skipped. `runs` is false whenever this is set,
	 * and nothing at all is measured — the period is not half-paid, it is not paid.
	 */
	deferral: Schema.NullOr(
		Schema.Struct({
			coversPeriod: Schema.String,
			paidInPeriod: Schema.String,
			days: dayRangeSchema
		})
	),
	/**
	 * Set when this run is paying a period an earlier one skipped.
	 *
	 * **The arrears is derived here, not carried from there.** What someone was owed for the month
	 * they joined is a fact about their contract and their start date, not about whether a run
	 * happened — a customer who onboards in February and never builds January must still pay the
	 * January days, and a system that answered "nothing was carried forward, so nothing is owed"
	 * would underpay in silence. Every input needed is on this run's own bundle.
	 */
	arrearsFor: Schema.NullOr(
		Schema.Struct({
			period: Schema.String,
			salary: dayRangeSchema,
			attendance: dayRangeSchema,
			days: dayRangeSchema
		})
	)
});
export type EmploymentSettlement = Schema.Schema.Type<typeof EmploymentSettlementSchema>;

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

/** Narrow a stored hire/exit pair, failing loudly on a row that has no start. */
export function employmentDates(
	employment: Pick<ResolvedEmployment, 'employee_number' | 'id' | 'hire_date' | 'exit_date'>
): EmploymentDates {
	const hire = dateKey(employment.hire_date);
	if (hire == null)
		throw new Error(
			`Employment ${employment.employee_number ?? employment.id ?? '(unknown)'} has no hire date.`
		);
	return { hire, exit: dateKey(employment.exit_date) };
}
