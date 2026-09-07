import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How a jurisdiction derives the rate of pay from a monthly wage: monthly wage ÷ divisor, per day
 * or per hour. Malaysia is DAY/26 (EA s.60I), Taiwan DAY/30, the Philippines DAY/21.75, Singapore
 * HOUR/190.67 (12 × monthly ÷ (52 × 44)), Indonesia HOUR/173 (PP 35/2021). A company using 30
 * where the statute says 26 underpays every overtime hour by 15%, which is why it is law and not
 * a company setting.
 *
 * Distinct from `proration`, the partial-month denominator: Malaysia prorates by calendar days and
 * prices an extra day at ÷26.
 */
export const ordinaryRateValueSchema = Schema.Struct({
	per: Schema.Literals(['DAY', 'HOUR']),
	divisor: Schema.Finite.check(Schema.isGreaterThan(0))
});

export type OrdinaryRate = Schema.Schema.Type<typeof ordinaryRateValueSchema>;

/** Strict standard view: a key the shape does not declare is refused rather than stripped. */
export const ordinaryRateSchema = Schema.toStandardSchemaV1(ordinaryRateValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'ordinary_rate',
	description:
		'The rate of pay a jurisdiction derives from a monthly wage: the wage divided by a statutory divisor, per day or per hour.',
	schema: ordinaryRateSchema
});
