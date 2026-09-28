/**
 * Proration. When the employment or a standing entry covers part of the period, the divisor comes
 * from `work_rules.proration` alone. What prorates is a component's cadence (basic and recurring
 * allowances), never its kind (E7/E22). The denominator is the whole calendar month in the basis's
 * units (calendar days, working days or a fixed factor), so two semi-monthly halves are not
 * each a month; a mid-month salary change is two segments summed (4,000 × 15/31 + 4,600 × 16/31).
 */

import type { Work } from './configuration.js';
import { isEligible, type PersonContext } from './eligibility.js';
import {
	inclusiveDays,
	intersectDays,
	monthBounds,
	monthDays,
	monthKey,
	type IsoDate
} from './dates.js';
import { decodeNumber } from '../../wire.js';

type DayWindow = {
	readonly start: string;
	readonly end: string;
};

/**
 * The basis this person prorates on: the terms row's own basis where the version leaves the
 * divisor to the contract (VN), else the first `proration_by` arm whose predicate holds over
 * them, else the version's `proration` (PH Handbook ch.2: the monthly-paid on 365/12, the
 * daily-paid on 261 or 313).
 */
export function prorationBasisFor(
	work: Pick<Work, 'proration' | 'proration_by' | 'proration_contractual'>,
	person: PersonContext
): Work['proration'] {
	if (work.proration_contractual === true && person.contract_proration != null)
		return person.contract_proration;
	for (const arm of work.proration_by ?? []) if (isEligible(arm.when, person)) return arm.basis;
	return work.proration;
}

/** What `prorationSegment` needs: the work's basis, the period, the person and the span covered. */
type ProrationFractionOptions = {
	readonly work: Work;
	readonly person: PersonContext;
	readonly period: DayWindow;
	readonly covered: DayWindow | null;
	/**
	 * The whole span employed in the period when `covered` is one terms row of it. A fixed factor
	 * prices the employed span once — a whole period is the instalment, a part period its working
	 * days capped at the instalment — and each row takes its working-day share, so a mid-month
	 * rate change neither out-pays nor under-pays the unsplit month. Defaults to `covered`.
	 */
	readonly employed?: DayWindow | undefined;
	readonly workingDaysIn: (window: DayWindow) => number;
	/**
	 * How many instalments of the month this period is one of — 2 for a semi-monthly employment,
	 * 1 otherwise. A fixed-factor basis splits the month's money into equal instalments, because
	 * that is the rate the instalment is paid at, and only the calendar and working-day bases
	 * distribute by the days the instalment happens to hold.
	 */
	readonly instalments?: number | undefined;
	/**
	 * The span the salary is stated for: the month (a monthly, semi-monthly, daily or hourly
	 * contract states a month's figure) or the week (a weekly contract states a week's). A weekly
	 * salary is prorated over its own week — calendar days over seven, working days over the
	 * week's — never over the month.
	 */
	readonly salaryPeriod?: 'MONTH' | 'WEEK' | undefined;
};

/**
 * The same arithmetic, with its working shown.
 *
 * A payslip stores `payslip_proration` entries, and every input to the fraction is stored beside
 * its result there — the days, the divisor they were taken over and the basis that counted them —
 * because a payslip has to be re-readable years after a work changed how it prorates.
 * Every caller divides the numerator by the denominator and nothing else, so the figure a
 * segment records and the figure the money was computed from cannot drift.
 *
 * `null` means the span does not touch the period at all, which is not the same as a fraction of
 * zero: there is no segment to record, rather than a segment that paid nothing.
 */
export function prorationSegment(options: ProrationFractionOptions): {
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly basis: NonNullable<Work['proration']>;
	readonly days: number;
	readonly denominator: number;
} | null {
	if (options.covered == null) return null;
	const basis = prorationBasisFor(options.work, options.person);
	const covered = intersectDays(options.covered, options.period);
	if (covered == null) return null;
	/**
	 * The divisor is the whole calendar month the period sits in — never the period itself.
	 *
	 * A semi-monthly company runs two instalments inside one month. Measured against its own
	 * working days, each half is a whole period: fraction 1.0, twice, and the monthly salary paid
	 * twice. `CALENDAR_DAYS` always read the month (`monthDays`), which is why Malaysia was right
	 * and the Philippines, Singapore and Vietnam were not. Read on the month, the instalments of a
	 * month sum to exactly one month on all three bases, and a monthly run — whose period *is* the
	 * month — computes what it always did.
	 */
	const month = monthBounds(monthKey(options.period.start));
	const measured = ((): { days: number; denominator: number } => {
		if (options.salaryPeriod === 'WEEK')
			return basis.by === 'CALENDAR_DAYS'
				? {
						days: inclusiveDays(covered.start, covered.end),
						denominator: inclusiveDays(options.period.start, options.period.end)
					}
				: {
						days: options.workingDaysIn(covered),
						denominator: options.workingDaysIn(options.period)
					};
		/**
		 * A fixed divisor: a whole period is its instalment of `divisor`, a part period its `count` of
		 * days capped at the instalment, each terms row taking its share. `count` is working days for
		 * FIXED_DAYS (DOLE 261/12 = 21.75, MY 26) and calendar days for a CALENDAR_DAYS month of fixed
		 * length (TW 30: a joiner on 16 January is 16/30, 勞動2字第1020083156號).
		 */
		const fixed = (
			divisor: number,
			count: (window: DayWindow) => number
		): { days: number; denominator: number } => {
			if (!(divisor > 0)) throw new Error('A fixed proration divisor must be positive.');
			// A whole period is a whole month's salary (DOLE Handbook ch.2 §E); a part period is capped at
			// the divisor, or a six-day roster's 26 June days would out-pay the whole month. A semi-monthly
			// instalment is its exact half (₱15,650 → ₱7,825), an absent day its own deduction.
			const instalments = options.instalments ?? 1;
			const instalment =
				instalments > 1
					? divisor / instalments
					: (() => {
							const monthDaysCounted = count(month);
							return monthDaysCounted > 0
								? divisor * (count(options.period) / monthDaysCounted)
								: divisor;
						})();
			const employed = intersectDays(options.employed ?? covered, options.period) ?? covered;
			const whole = employed.start <= options.period.start && employed.end >= options.period.end;
			const employedDays = count(employed);
			const priced = whole ? instalment : Math.min(employedDays, instalment);
			const share =
				employedDays > 0
					? count(covered) / employedDays
					: covered.start === employed.start && covered.end === employed.end
						? 1
						: 0;
			return { days: priced * share, denominator: divisor };
		};
		switch (basis.by) {
			case 'CALENDAR_DAYS':
				return basis.days == null
					? {
							days: inclusiveDays(covered.start, covered.end),
							denominator: monthDays(options.period.start)
						}
					: fixed(basis.days, (window) => inclusiveDays(window.start, window.end));
			case 'WORKING_DAYS':
				return {
					days: options.workingDaysIn(covered),
					denominator: options.workingDaysIn(month)
				};
			case 'FIXED_DAYS':
				return fixed(basis.days, options.workingDaysIn);
		}
		throw new Error(`Unsupported proration basis: ${Reflect.get(basis, 'by')}`);
	})();
	return { from: covered.start, to: covered.end, basis, ...measured };
}
