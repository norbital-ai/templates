import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One statutory scheme's charge on a payslip.
 *
 * STATUTORY is caused by no input; it is caused by the sum. A contribution is calculated from the
 * base and the proration above it, so there is no source record to point at and nothing to freeze —
 * which is why it is inlined here and not a row in `payslip_adjustments`.
 *
 * Employee and employer are two numbers on one charge rather than two rows. They are produced by one
 * pass over one scheme against one wage, and splitting them made every reader re-pair them by
 * scheme and hope neither half was missing.
 *
 * The scheme is named by its code, not by a `statutory_contributions` id. An output is a frozen
 * fact and a naked uuid with no foreign key is not a relationship; the scheme itself, with the
 * exact rules in force, is captured whole in the run's configuration snapshot, and the run's
 * `statutory_snapshot_id` names the law that governed it.
 */
export const payslipStatutoryValueSchema = Schema.Struct({
	/** The scheme's code, as `statutory_contributions.code` spelled it at settlement. */
	scheme_code: Schema.NonEmptyString,
	/** The authority the scheme's charge answers to, frozen for the reading auditor. */
	authority: Schema.NullOr(Schema.String),
	/** The wage the scheme was charged on. */
	base_amount: Schema.Finite,
	employee_amount: Schema.Finite,
	employer_amount: Schema.Finite,
	/** The `when` of the scheme's own rule the amounts were read from, where one governed. */
	rule_when: Schema.NullOr(Schema.String)
});

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const payslipStatutorySchema = Schema.toStandardSchemaV1(payslipStatutoryValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'payslip_statutory',
	description:
		'One statutory scheme charged on a payslip: the code and authority of the scheme, the wage it was charged on, what it took from the employee, what it cost the employer, and the rule condition it was read from.',
	schema: payslipStatutorySchema
});
