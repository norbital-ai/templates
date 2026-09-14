import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How one run's statutory charges were derived (RFC 0002 §5, §7): one entry per payslip, one
 * scheme entry per charge, each naming the priced lines that fed its base, the producers it read,
 * the rule that governed and the two shares it wrote.
 *
 * This is the run's audit trail, not a second calculation: every figure is copied from the charge
 * the engine already wrote, so a reader can trace base → rule → charge without re-deriving it.
 */

const traceInputSchema = Schema.Struct({
	/** The catalogue component or work class the line settles under, e.g. `OVERTIME`. */
	code: Schema.String,
	/** The band label that priced it, e.g. the OT class `1.5`. */
	label: Schema.String,
	effect: Schema.Literals(['INCLUDE', 'REDUCE']),
	amount: Schema.Finite
});

const traceReadSchema = Schema.Struct({
	/** The producer named by a `produced.<code>` read. */
	code: Schema.String,
	/** The relievable employee amount the read supplied. */
	employee_amount: Schema.Finite,
	employer_amount: Schema.Finite
});

const traceSchemeSchema = Schema.Struct({
	scheme_code: Schema.String,
	/** The governing rule's `when`, or null where the scheme charged at zero. */
	rule_when: Schema.NullOr(Schema.String),
	base_amount: Schema.Finite,
	employee_amount: Schema.Finite,
	employer_amount: Schema.Finite,
	/** The priced lines whose signed sum is the base, in the order the engine accumulated them. */
	inputs: Schema.Array(traceInputSchema),
	/** The `produced.<code>` reads this charge made, in first-mention order. */
	reads: Schema.Array(traceReadSchema)
});

const tracePayslipSchema = Schema.Struct({
	employment_id: Schema.String,
	employee_number: Schema.String,
	schemes: Schema.Array(traceSchemeSchema)
});

export const payrollTraceValueSchema = Schema.Array(tracePayslipSchema);
export type PayrollTrace = Schema.Schema.Type<typeof payrollTraceValueSchema>;

export default defineCustomType({
	name: 'payroll_trace',
	description:
		'The calculation flow behind one payroll run: per payslip, each charged scheme with the lines that fed its base, the producer reads it made, the governing rule and the two shares written.',
	schema: Schema.toStandardSchemaV1(payrollTraceValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
