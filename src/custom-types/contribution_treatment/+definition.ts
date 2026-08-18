import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How one pay component is charged against one statutory contribution.
 * `UNSET` is the generated default — every (component_type, contribution) pair exists
 * as a row, so chargeability is never inferred from a missing row.
 * `SPECIAL.rule` must name a rule listed on `statutory_contributions.special_rules`.
 *
 * `NonEmptyString` rather than `String`: an empty `rule` names no rule on the contribution, and
 * accepting one would store a `SPECIAL` treatment that resolves to nothing at valuation time.
 */
export const contributionTreatmentValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('INCLUDE') }),
	Schema.Struct({ kind: Schema.Literal('EXCLUDE') }),
	Schema.Struct({ kind: Schema.Literal('REDUCE') }),
	Schema.Struct({ kind: Schema.Literal('SPECIAL'), rule: Schema.NonEmptyString }),
	Schema.Struct({ kind: Schema.Literal('UNSET') })
]);

export type ContributionTreatment = Schema.Schema.Type<typeof contributionTreatmentValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const contributionTreatmentSchema = Schema.toStandardSchemaV1(
	contributionTreatmentValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'contribution_treatment',
	description:
		'Whether one pay component is included in, excluded from, reduced against or specially ruled by one statutory contribution, with UNSET meaning that pair has not been decided yet.',
	schema: contributionTreatmentSchema
});
