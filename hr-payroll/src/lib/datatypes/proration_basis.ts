import { Schema } from 'effect';

/**
 * How a jurisdiction prorates a monthly wage across a partial period.
 * `FIXED_DAYS` names the divisor explicitly (e.g. 26 working days). `CALENDAR_DAYS` counts calendar
 * days over the month's own length, or over `days` where the version states one (TW: 民法 §123(2)
 * reads a month as 30 days; 勞動2字第1020083156號 lets the parties divide by 30 provided 事假 and
 * rest-day pay use the same figure).
 */
const positiveDays = Schema.Finite.check(Schema.isGreaterThan(0));
export const prorationBasisValueSchema = Schema.Union([
	Schema.Struct({ by: Schema.Literal('CALENDAR_DAYS'), days: Schema.optionalKey(positiveDays) }),
	Schema.Struct({ by: Schema.Literal('WORKING_DAYS') }),
	Schema.Struct({
		by: Schema.Literal('FIXED_DAYS'),
		days: positiveDays
	})
]);

export type ProrationBasis = Schema.Schema.Type<typeof prorationBasisValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const prorationBasisSchema = Schema.toStandardSchemaV1(prorationBasisValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = prorationBasisSchema;
