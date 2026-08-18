import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What taking this leave does to pay. `UNPAID` names the deduction pay component that
 * carries the lost wage. A variant cannot be a foreign key — `component_id` is validated
 * in `+hooks.ts`, not by a constraint.
 */
export const leavePayrollEffectValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('PAID') }),
	Schema.Struct({
		kind: Schema.Literal('UNPAID'),
		component_id: Schema.String.check(Schema.isUUID())
	})
]);

export type LeavePayrollEffect = Schema.Schema.Type<typeof leavePayrollEffectValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const leavePayrollEffectSchema = Schema.toStandardSchemaV1(leavePayrollEffectValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_payroll_effect',
	description:
		'Whether taking this leave is paid, or unpaid and deducted through the pay component named here.',
	schema: leavePayrollEffectSchema
});
