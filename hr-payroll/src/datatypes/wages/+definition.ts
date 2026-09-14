import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Region → monthly minimum wage, in the version's currency (RFC 0001 §4). A company names its
 * region; a scheme's `FLOOR:MINIMUM_WAGE` and `CAP:MINIMUM_WAGE_X:<n>` rules read the wage of that
 * region through `minimum_wage(region)`.
 */
export const wagesValueSchema = Schema.Struct({
	by_region: Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))).check(
		Schema.makeFilter(
			(map) =>
				Object.keys(map).every((region) => region.trim() !== '') ||
				'A wage is keyed by a region; an empty region names nowhere.'
		)
	)
});

export type Wages = Schema.Schema.Type<typeof wagesValueSchema>;

export default defineCustomType({
	name: 'wages',
	description:
		'Regional minimum wages of one jurisdiction settings version, keyed by region name, in its currency.',
	schema: Schema.toStandardSchemaV1(wagesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
