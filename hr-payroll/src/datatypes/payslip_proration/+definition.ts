import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';
import { prorationBasisValueSchema } from '../proration_basis/+definition.js';

/**
 * One segment of what the calendar did to the base amount.
 *
 * A joiner, a leaver or a mid-month salary change splits a period into segments, each covered by one
 * `employment_terms` row and each prorated against the same full-period denominator. The segments
 * sum: 4,000 x 15/31 + 4,600 x 16/31 is two entries here, and the two halves of the month never add
 * up to more or less than a month.
 *
 * Every input to the arithmetic is stored beside its result, because a payslip has to be re-readable
 * years after the jurisdiction's proration basis changed. `days / denominator` is the fraction, and
 * `contract_amount x fraction` is `prorated_amount`; nothing downstream recomputes it.
 */
export const payslipProrationValueSchema = Schema.Struct({
	/**
	 * The terms segment this proration came from, as an immutable label/snapshot key rather than a
	 * `employment_terms` id: an output is a frozen fact and a naked uuid with no foreign key is not
	 * a relationship. The key composes the terms' own title with the day its effective range
	 * opens, which is exactly as much identity as a settled segment needs to stay re-readable.
	 */
	term_key: Schema.NonEmptyString,
	from: calendarDay,
	to: calendarDay,
	/** The jurisdiction's divisor rule, copied at settlement so a later change cannot rewrite it. */
	basis: prorationBasisValueSchema,
	/** Days of the period this segment covered, counted the way `basis` counts them. */
	days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	/** The divisor those days were taken over. */
	denominator: Schema.Finite.check(Schema.isGreaterThan(0)),
	/** The full-period amount the segment's terms row states. */
	contract_amount: Schema.Finite,
	/** `contract_amount x days / denominator`, rounded the way the run rounds. */
	prorated_amount: Schema.Finite
});

export type PayslipProration = Schema.Schema.Type<typeof payslipProrationValueSchema>;

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const payslipProrationSchema = Schema.toStandardSchemaV1(payslipProrationValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'payslip_proration',
	description:
		'One segment of a prorated period on a payslip: the terms label it came from, the days it covered, the divisor they were taken over, and both the contract amount and the prorated result.',
	schema: payslipProrationSchema
});
