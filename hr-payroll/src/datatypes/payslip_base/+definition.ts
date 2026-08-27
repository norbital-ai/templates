import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One contracted amount on a payslip, taken from the employment terms and the period.
 *
 * BASE is what the contract says, before the calendar touches it. It is caused by no input — there
 * is nothing to point at — which is exactly why it is inlined on `payslips` rather than being a row
 * in the adjustments table: a row with a null source would be a row whose kind had to be declared,
 * and the kind is derived, never declared.
 *
 * `pay_component_id` is a `pay_components` id and deliberately not a foreign key. Inlining is the
 * decision; a settled payslip is a frozen statement of what was paid, and it does not become wrong
 * because somebody later archived a component. The catalogue link a screen needs is the same id.
 */
export const payslipBaseValueSchema = Schema.Struct({
	pay_component_id: Schema.String.check(Schema.isUUID()),
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
		'One contracted amount on a payslip: the pay component the employment terms name, and what it pays for the whole period.',
	schema: payslipBaseSchema
});
