import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';
import { instantRangeValueSchema } from '@norbital-ai/bolt/authoring';

const statutoryTreatmentSchema = Schema.Struct({
	statutory_contribution_id: Schema.String.check(Schema.isUUID()),
	authority: Schema.NonEmptyString,
	treatment: contributionTreatmentValueSchema,
	effective_range: instantRangeValueSchema
});
const treatments = Schema.Array(statutoryTreatmentSchema);

/**
 * Economic direction and statutory treatment are one closed policy union on the component.
 *
 * `onExcessProperty: 'error'` is applied by the authoring surface to every custom-type value, so a
 * key belonging to a different arm is reported rather than stripped, and the component is never
 * stored settling in a direction nobody declared.
 */
export const payComponentPolicyValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('INFORMATION'),
		settlement: Schema.Literal('NONE'),
		statutory_treatments: treatments
	}),
	Schema.Struct({
		kind: Schema.Literal('EARNING'),
		settlement: Schema.Literal('ADD'),
		statutory_treatments: treatments
	}),
	Schema.Struct({
		kind: Schema.Literal('ABSENCE'),
		settlement: Schema.Literal('DEDUCT'),
		statutory_treatments: treatments
	}),
	Schema.Struct({
		kind: Schema.Literal('DEDUCTION'),
		settlement: Schema.Literal('DEDUCT'),
		statutory_treatments: treatments
	}),
	Schema.Struct({
		kind: Schema.Literal('NON_WAGE_PAYMENT'),
		settlement: Schema.Literal('ADD'),
		statutory_treatments: treatments
	}),
	Schema.Struct({
		kind: Schema.Literal('EMPLOYER_COST'),
		settlement: Schema.Literal('EMPLOYER_ONLY'),
		statutory_treatments: treatments
	})
]);

export type PayComponentPolicy = Schema.Schema.Type<typeof payComponentPolicyValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const payComponentPolicySchema = Schema.toStandardSchemaV1(payComponentPolicyValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
export default defineCustomType({
	name: 'pay_component_policy',
	description:
		'Whether a pay component adds to net pay, deducts from it, costs the employer alone or is information only, together with how each statutory contribution charges it over each effective range.',
	schema: payComponentPolicySchema
});
