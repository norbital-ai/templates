import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How a jurisdiction derives the rate of pay from a monthly wage: monthly wage ÷ divisor, per day
 * or per hour. Malaysia is DAY/26 (EA s.60I), Taiwan DAY/30, the Philippines DAY/21.75, Singapore
 * HOUR/190.67 (12 × monthly ÷ (52 × 44)), Indonesia HOUR/173 (PP 35/2021). A company using 30
 * where the statute says 26 underpays every overtime hour by 15%, which is why it is law and not
 * a company setting.
 *
 * Rows are read top-down and the first predicate that holds for the person is the rate: a
 * daily-paid Filipino reads a different divisor from a monthly-paid one, a Vietnamese contract
 * divides by the month's actual working days (`WORKING_DAYS`). The last row is normally everyone.
 *
 * Distinct from `proration`, the partial-month denominator: Malaysia prorates by calendar days and
 * prices an extra day at ÷26.
 */
export const ordinaryRateRowSchema = Schema.Struct({
	/** Who the row is for; empty is everyone. */
	eligibility: Schema.String,
	per: Schema.Literals(['DAY', 'HOUR']),
	divisor: Schema.Union([
		Schema.Finite.check(Schema.isGreaterThan(0)),
		Schema.Literal('WORKING_DAYS')
	])
});
export type OrdinaryRateRow = Schema.Schema.Type<typeof ordinaryRateRowSchema>;

export const ordinaryRateValueSchema = Schema.Array(ordinaryRateRowSchema).check(
	Schema.isMinLength(1)
);

export type OrdinaryRate = Schema.Schema.Type<typeof ordinaryRateValueSchema>;

/** Strict standard view: a key the shape does not declare is refused rather than stripped. */
export const ordinaryRateSchema = Schema.toStandardSchemaV1(ordinaryRateValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'ordinary_rate',
	description:
		'The rate of pay a jurisdiction derives from a monthly wage, as rows read top-down: who the row is for, and the wage divided by a statutory divisor (or the month’s working days), per day or per hour.',
	schema: ordinaryRateSchema
});
