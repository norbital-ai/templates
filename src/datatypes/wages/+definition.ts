import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * Region → monthly minimum wage, in the version's currency. A company names its
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
	),
	/**
	 * Who the wages order covers: a boolean over the person, empty for everyone. A person it
	 * excludes — an intern on industrial training, an apprentice before the order reached them, a
	 * domestic servant — reads `wage_floor` as 0 in scheme rules, so a base floored at the minimum
	 * wage is not floored for them, while `minimum_wage(region)` still states the table for the
	 * ceilings that read it.
	 */
	applies_when: Schema.optionalKey(Schema.String),
	/**
	 * The share of the region's wage a covered person's floor is, over the person; absent is the
	 * whole wage. An apprentice or learner the order covers at 75% (PH Labor Code art.61, art.75)
	 * reads `wage_floor` as three quarters of the table while `minimum_wage(region)` still
	 * states the table.
	 */
	scale: Schema.optionalKey(Schema.String),
	/**
	 * What a covered contract must satisfy beyond the floor, over the person; absent is nothing.
	 * A composition rule (ID PP 36/2021 art.7(2): the basic wage is at least 75% of basic plus
	 * the fixed allowances) is judged where the floor is, and a contract that fails it warns on
	 * the run the same way.
	 */
	terms_when: Schema.optionalKey(Schema.String)
}).check(
	Schema.makeFilter((wages) => {
		const fault =
			compileExpression({
				expression: wages.applies_when,
				site: 'person',
				type: 'boolean'
			}) ??
			(wages.scale == null || wages.scale.trim() === ''
				? null
				: compileExpression({ expression: wages.scale, site: 'person', type: 'number' })) ??
			(wages.terms_when == null || wages.terms_when.trim() === ''
				? null
				: compileExpression({ expression: wages.terms_when, site: 'person', type: 'boolean' }));
		return fault == null || `Minimum wage coverage: ${fault}`;
	})
);

export type Wages = Schema.Schema.Type<typeof wagesValueSchema>;

export default defineCustomType({
	name: 'wages',
	description:
		'Regional minimum wages of one jurisdiction settings version, keyed by region name, in its currency.',
	schema: Schema.toStandardSchemaV1(wagesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
