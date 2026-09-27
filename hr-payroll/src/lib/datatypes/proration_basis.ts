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

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = prorationBasisSchema;
