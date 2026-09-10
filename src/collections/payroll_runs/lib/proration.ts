/**
 * Proration.
 *
 * An amount is prorated when the employment — or a standing entry's own effective range — covers
 * only part of the pay period. The divisor comes from `work_catalogue.proration` and nothing else:
 * there is no `prorates` flag on a component, no proration arithmetic inside a formula, and no
 * branch on a component's name.
 *
 * What prorates is a component's **cadence**, not its kind: basic salary and a recurring allowance
 * do, a one-off claim, a payment and a loan instalment do not. Keying on cadence is what removes the
 * type-name branch the plan itself worries about (decision E7 / E22).
 *
 * The denominator is the whole calendar **month** measured on the basis's own units — the month's
 * calendar days, its working days, or the statutory factor a `FIXED_DAYS` basis names — and the
 * numerator is counted in those same units. It is the month rather than the run period because a
 * semi-monthly company runs two periods inside one month, and a divisor taken from the period makes
 * each half a whole month.
 *
 * A salary change mid-month produces two terms rows, each prorated against that same divisor and
 * summed — 4,000 × 15/31 + 4,600 × 16/31 — so the two halves of the month never add up to more or
 * less than a month, on any basis and at any pay frequency.
 */

import { Schema } from 'effect';
import type { Work } from './configuration.js';
import {
	inclusiveDays,
	intersectDays,
	monthBounds,
	monthDays,
	monthKey,
	type IsoDate
} from './dates.js';
import { decodeNumber } from '@norbital-ai/std/json';

const DayWindowSchema = Schema.Struct({ start: Schema.String, end: Schema.String });
type DayWindow = Schema.Schema.Type<typeof DayWindowSchema>;

/** What `prorationFraction` needs: the work's basis, the period and the span covered. */
type ProrationFractionOptions = {
	readonly work: Work;
	readonly period: DayWindow;
	readonly covered: DayWindow | null;
	readonly workingDaysIn: (window: DayWindow) => number;
};

/**
 * The fraction of a pay period a span of employment covers.
 *
 * `workingDaysIn` is consulted for a `WORKING_DAYS` work and for a part period of a `FIXED_DAYS`
 * one — both count working days — and is supplied by the caller because only the schedule knows
 * which days those are (public holidays excluded — decision E20).
 */
export function prorationFraction(options: ProrationFractionOptions): number {
	const segment = prorationSegment(options);
	return segment == null || segment.denominator <= 0 ? 0 : segment.days / segment.denominator;
}

/**
 * The same arithmetic, with its working shown.
 *
 * A payslip stores `payslip_proration` entries, and every input to the fraction is stored beside
 * its result there — the days, the divisor they were taken over and the basis that counted them —
 * because a payslip has to be re-readable years after a work changed how it prorates.
 * `prorationFraction` is this function's numerator over its denominator and nothing else, so the
 * figure a segment records and the figure the money was computed from cannot drift.
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
	const basis = options.work.proration;
	if (basis == null)
		throw new Error(
			`The Work catalogue of settings version ${options.work.settings_id} states no proration basis.`
		);
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
		switch (basis.by) {
			case 'CALENDAR_DAYS':
				return {
					days: inclusiveDays(covered.start, covered.end),
					denominator: monthDays(options.period.start)
				};
			case 'WORKING_DAYS':
				return {
					days: options.workingDaysIn(covered),
					denominator: options.workingDaysIn(month)
				};
			case 'FIXED_DAYS': {
				const divisor = decodeNumber(basis.days);
				if (!(divisor > 0))
					throw new Error('A FIXED_DAYS proration basis needs a positive divisor.');
				// A fixed divisor is a **working**-day factor — the DOLE 261/12 = 21.75, Malaysia's
				// 26 — so its numerator counts working days, exactly as `WORKING_DAYS` does. Counting
				// calendar days into it prices a whole 31-day January at 31/21.75 = 1.4253 months.
				//
				// A whole period is a whole month's salary whatever that month's working days come
				// to: a monthly-paid employee present all month earns the monthly rate (DOLE
				// Handbook ch.2 §E), so the numerator there is the divisor itself and only a partial
				// period is measured — at the daily rate the factor states.
				//
				// A part period is capped at the divisor: a roster that works more days in a month
				// than the factor counts — the Philippine 21.75 beside a six-day pattern, where June
				// 2026 holds 26 working days — would otherwise price 22 covered days at 22/21.75 and
				// pay someone present for part of the month more than someone present for all of it.
				// The cap is on the days, not the fraction, so the segment a payslip stores and the
				// money it was paid cannot disagree.
				//
				// The factor is a month's worth of days, so an instalment that is only part of a
				// month is worth only its share of one — measured in the same working days the
				// factor itself counts. A monthly run's share is 1 and the arithmetic below is
				// unchanged; a semi-monthly month's two shares sum to 1, so the halves pay one
				// month between them rather than one month each.
				const monthWorkingDays = options.workingDaysIn(month);
				const instalment =
					monthWorkingDays > 0
						? divisor * (options.workingDaysIn(options.period) / monthWorkingDays)
						: divisor;
				const whole = covered.start <= options.period.start && covered.end >= options.period.end;
				return {
					days: whole ? instalment : Math.min(options.workingDaysIn(covered), instalment),
					denominator: divisor
				};
			}
		}
		throw new Error(`Unsupported proration basis: ${Reflect.get(basis, 'by')}`);
	})();
	return { from: covered.start, to: covered.end, basis, ...measured };
}
