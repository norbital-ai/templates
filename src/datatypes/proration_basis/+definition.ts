import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How a jurisdiction prorates a monthly wage across a partial period.
 * `FIXED_DAYS` names the divisor explicitly (e.g. 26 working days).
 */
export const prorationBasisValueSchema = Schema.Union([
	Schema.Struct({ by: Schema.Literal('CALENDAR_DAYS') }),
	Schema.Struct({ by: Schema.Literal('WORKING_DAYS') }),
	Schema.Struct({
		by: Schema.Literal('FIXED_DAYS'),
		days: Schema.Finite.check(Schema.isGreaterThan(0))
	})
]);

export type ProrationBasis = Schema.Schema.Type<typeof prorationBasisValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const prorationBasisSchema = Schema.toStandardSchemaV1(prorationBasisValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'proration_basis',
	description:
		'The divisor a jurisdiction prorates a monthly wage by across a partial period: calendar days, working days, or a fixed number of days such as 26.',
	schema: prorationBasisSchema
});
