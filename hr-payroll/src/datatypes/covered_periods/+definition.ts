import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

export const coveredPeriodsValueSchema = Schema.Array(
	Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/))
);

export type CoveredPeriods = Schema.Schema.Type<typeof coveredPeriodsValueSchema>;

export const coveredPeriodsSchema = Schema.toStandardSchemaV1(coveredPeriodsValueSchema);

export default defineCustomType({
	name: 'covered_periods',
	description:
		'Historical months referenced by a manual payment, each written YYYY-MM. Empty when the payment does not cover prior periods.',
	schema: coveredPeriodsSchema
});
