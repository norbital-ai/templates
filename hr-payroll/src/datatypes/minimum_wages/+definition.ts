import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Region → monthly minimum wage, in the settings version's currency. A company names its region;
 * a scheme's `FLOOR:MINIMUM_WAGE` and `CAP:MINIMUM_WAGE_X:<n>` rules read the wage of that region.
 */
export const minimumWagesValueSchema = Schema.Record(
	Schema.String,
	Schema.Finite.check(Schema.isGreaterThan(0))
).check(
	Schema.makeFilter(
		(map) =>
			Object.keys(map).every((region) => region.trim() !== '') ||
			'A minimum wage is keyed by a region; an empty region names nowhere.'
	)
);

export const minimumWagesSchema = Schema.toStandardSchemaV1(minimumWagesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'minimum_wages',
	description:
		'Regional minimum wages of one jurisdiction settings version, keyed by region name, in its currency.',
	schema: minimumWagesSchema
});
