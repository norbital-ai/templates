/**
 * Proration.
 *
 * An amount is prorated when the employment — or a standing entry's own effective range — covers
 * only part of the pay period. The divisor comes from `jurisdictions.proration` and nothing else:
 * there is no `prorates` flag on a pay component, no proration arithmetic inside a formula, and no
 * branch on a pay component's name.
 *
 * What prorates is a component's **cadence**, not its kind: basic salary and a recurring allowance
 * do, a one-off claim, a bonus and a loan instalment do not. Keying on cadence is what removes the
 * type-name branch the plan itself worries about (decision E7 / E22).
 *
 * The denominator is the calendar length of the pay period's month. A salary change mid-month
 * produces two terms rows, each prorated against that same full-month divisor and summed —
 * 4,000 × 15/31 + 4,600 × 16/31 — so the two halves of the month never add up to more or less than
 * a month.
 */

import { Schema } from 'effect';
import type { Jurisdiction } from './configuration.js';
import { inclusiveDays, intersectDays, monthDays, type IsoDate } from './dates.js';
import { decodeNumber } from '@norbital-ai/std/json';

const DayWindowSchema = Schema.Struct({ start: Schema.String, end: Schema.String });
type DayWindow = Schema.Schema.Type<typeof DayWindowSchema>;

/** What `prorationFraction` needs: the jurisdiction's basis, the period and the span covered. */
type ProrationFractionOptions = {
	readonly jurisdiction: Jurisdiction;
	readonly period: DayWindow;
	readonly covered: DayWindow | null;
	readonly workingDaysIn: (window: DayWindow) => number;
};

/**
 * The fraction of a pay period a span of employment covers.
 *
 * `workingDaysIn` is only consulted for a `WORKING_DAYS` jurisdiction, and is supplied by the
 * caller because only the schedule knows which days those are (public holidays excluded — decision
 * E20).
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
 * because a payslip has to be re-readable years after a jurisdiction changed how it prorates.
 * `prorationFraction` is this function's numerator over its denominator and nothing else, so the
 * figure a segment records and the figure the money was computed from cannot drift.
 *
 * `null` means the span does not touch the period at all, which is not the same as a fraction of
 * zero: there is no segment to record, rather than a segment that paid nothing.
 */
export function prorationSegment(options: ProrationFractionOptions): {
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly basis: NonNullable<Jurisdiction['proration']>;
	readonly days: number;
	readonly denominator: number;
} | null {
	if (options.covered == null) return null;
	const basis = options.jurisdiction.proration;
	if (basis == null)
		throw new Error(`Jurisdiction ${options.jurisdiction.code} states no proration basis.`);
	const covered = intersectDays(options.covered, options.period);
	if (covered == null) return null;
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
					denominator: options.workingDaysIn(options.period)
				};
			case 'FIXED_DAYS': {
				const divisor = decodeNumber(basis.days);
				if (!(divisor > 0))
					throw new Error('A FIXED_DAYS proration basis needs a positive divisor.');
				return { days: inclusiveDays(covered.start, covered.end), denominator: divisor };
			}
		}
		throw new Error(`Unsupported proration basis: ${Reflect.get(basis, 'by')}`);
	})();
	return { from: covered.start, to: covered.end, basis, ...measured };
}
