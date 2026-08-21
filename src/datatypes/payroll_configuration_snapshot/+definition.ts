import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** One immutable, run-level record of the configuration that produced every payslip in the run. */
export const payrollConfigurationSnapshotValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('CAPTURED'),
		configuration_hash: Schema.String.check(Schema.isMinLength(1)),
		configuration: Schema.Record(Schema.String, Schema.Unknown)
	})
]);

export type PayrollConfigurationSnapshot = Schema.Schema.Type<
	typeof payrollConfigurationSnapshotValueSchema
>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const payrollConfigurationSnapshotSchema = Schema.toStandardSchemaV1(
	payrollConfigurationSnapshotValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'payroll_configuration_snapshot',
	description:
		'The frozen copy of the rates, rules and terms a payroll run was calculated under, so every payslip stays traceable to the configuration that produced it.',
	schema: payrollConfigurationSnapshotSchema
});
