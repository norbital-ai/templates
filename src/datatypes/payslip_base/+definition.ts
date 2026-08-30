import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One contracted amount on a payslip, taken from the employment terms and the period.
 *
 * BASE is what the contract says, before the calendar touches it. It is caused by no input — there
 * is nothing to point at — which is exactly why it is inlined on `payslips` rather than being a row
 * in the adjustments table: a row with no causal input is not an adjustment, it is base.
 *
 * `component_code` is the catalogue code the amount settled under, frozen at settlement. It is
 * deliberately not a `pay_components` id: an output is a frozen fact, and a naked uuid that looks
 * like a relationship but carries no foreign key is exactly what this workspace refuses to store.
 * The component the code names lives on in the run's configuration snapshot, so the settled figure
 * stays re-readable after the catalogue row is archived or renamed.
 */
export const payslipBaseValueSchema = Schema.Struct({
	component_code: Schema.NonEmptyString,
	amount: Schema.Finite
});

export type PayslipBase = Schema.Schema.Type<typeof payslipBaseValueSchema>;

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const payslipBaseSchema = Schema.toStandardSchemaV1(payslipBaseValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'payslip_base',
	description:
		'One contracted amount on a payslip: the pay component code it settled under, and what it pays for the whole period.',
	schema: payslipBaseSchema
});
