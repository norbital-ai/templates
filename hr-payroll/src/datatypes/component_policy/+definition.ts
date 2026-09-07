import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The economic direction of a component: one closed union whose arm fixes the settlement.
 *
 * Statutory chargeability is not here. It is `component_catalogue.contribution_treatments`, one cell per
 * scheme code, because "what does EPF do with this money" is a fact about the component and the
 * scheme, not about which way the money settles.
 *
 * `onExcessProperty: 'error'` is applied by the authoring surface to every custom-type value, so a
 * key belonging to a different arm is reported rather than stripped, and the component is never
 * stored settling in a direction nobody declared.
 */
export const componentPolicyValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('INFORMATION'), settlement: Schema.Literal('NONE') }),
	Schema.Struct({ kind: Schema.Literal('EARNING'), settlement: Schema.Literal('ADD') }),
	Schema.Struct({ kind: Schema.Literal('ABSENCE'), settlement: Schema.Literal('DEDUCT') }),
	Schema.Struct({ kind: Schema.Literal('DEDUCTION'), settlement: Schema.Literal('DEDUCT') }),
	Schema.Struct({ kind: Schema.Literal('NON_WAGE_PAYMENT'), settlement: Schema.Literal('ADD') }),
	Schema.Struct({
		kind: Schema.Literal('EMPLOYER_COST'),
		settlement: Schema.Literal('EMPLOYER_ONLY')
	})
]);

export type ComponentPolicy = Schema.Schema.Type<typeof componentPolicyValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const componentPolicySchema = Schema.toStandardSchemaV1(componentPolicyValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
export default defineCustomType({
	name: 'component_policy',
	description:
		'Whether a component adds to net pay, deducts from it, costs the employer alone or is information only. The settlement direction is fixed by the kind.',
	schema: componentPolicySchema
});
