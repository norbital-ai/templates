import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const payComponentId = { pay_component_id: Schema.String.check(Schema.isUUID()) } as const;
const entryIds = {
	...payComponentId,
	component_entry_id: Schema.String.check(Schema.isUUID())
} as const;
const statutory = {
	statutory_contribution_id: Schema.String.check(Schema.isUUID()),
	base_amount: Schema.Finite,
	band_reference: Schema.NullOr(Schema.String),
	special_amounts: Schema.Record(Schema.String, Schema.Finite)
} as const;

/**
 * The exact thing one persisted payslip line represents. This closed union makes the line itself the
 * only junction: ordinary calculated components link to `pay_components`, entered components also
 * link to `component_entries`, unpaid leave names the leave requests it deducted, a loan instalment
 * names the agreement row and sequence it recovered, and statutory lines link to their governing
 * scheme.
 */
export const payslipLineComponentValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('SCHEDULE'), ...payComponentId }),
	Schema.Struct({ kind: Schema.Literal('FORMULA'), ...payComponentId }),
	Schema.Struct({
		kind: Schema.Literal('LEAVE_UNPAID'),
		...payComponentId,
		leave_request_ids: Schema.Array(Schema.String.check(Schema.isUUID()))
	}),
	Schema.Struct({
		kind: Schema.Literal('LOAN_INSTALMENT'),
		...payComponentId,
		agreement_id: Schema.String.check(Schema.isUUID()),
		sequence: Schema.Finite
	}),
	Schema.Struct({ kind: Schema.Literal('OVERTIME'), ...payComponentId }),
	Schema.Struct({ kind: Schema.Literal('OVERTIME_EXCESS'), ...payComponentId }),
	Schema.Struct({ kind: Schema.Literal('DERIVED'), ...payComponentId }),
	Schema.Struct({ kind: Schema.Literal('COMPONENT_ENTRY_ONCE'), ...entryIds }),
	Schema.Struct({ kind: Schema.Literal('COMPONENT_ENTRY_RECURRING'), ...entryIds }),
	Schema.Struct({ kind: Schema.Literal('STATUTORY_EMPLOYEE'), ...statutory }),
	Schema.Struct({ kind: Schema.Literal('STATUTORY_EMPLOYER'), ...statutory })
]);

export type PayslipLineComponent = Schema.Schema.Type<typeof payslipLineComponentValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const payslipLineComponentSchema = Schema.toStandardSchemaV1(
	payslipLineComponentValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'payslip_line_component',
	description:
		'What one payslip line stands for — contracted salary, a formula, unpaid leave linked to its requests, a numbered loan instalment, overtime or excess overtime, a derived or entered component, or an employee or employer statutory contribution — and the pay component, leave requests, agreement, component entry or scheme it is linked to.',
	schema: payslipLineComponentSchema
});
