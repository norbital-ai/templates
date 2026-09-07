import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The past pay periods an arrears settlement covers, as `YYYY-MM`.
 *
 * A list of scalars rather than a relation: these name periods that may have no run, no payslip and
 * no row anywhere — an arrears settlement for a month the company had not yet onboarded is the
 * ordinary case. There is no array column in this authoring surface, so the list is a value.
 */
export const coveredPeriodsValueSchema = Schema.Array(
	Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/))
).check(Schema.isMinLength(1));

export type CoveredPeriods = Schema.Schema.Type<typeof coveredPeriodsValueSchema>;

export const coveredPeriodsSchema = Schema.toStandardSchemaV1(coveredPeriodsValueSchema);

export default defineCustomType({
	name: 'covered_periods',
	description:
		'The past pay periods an arrears settlement covers, each written YYYY-MM. At least one.',
	schema: coveredPeriodsSchema
});
