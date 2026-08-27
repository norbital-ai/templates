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
 * `statutory_contribution_id` and hope neither half was missing.
 */
export const payslipStatutoryValueSchema = Schema.Struct({
	/** A `statutory_contributions` id. Inlined, so not a foreign key. */
	statutory_contribution_id: Schema.String.check(Schema.isUUID()),
	/** The wage the scheme was charged on. */
	base_amount: Schema.Finite,
	employee_amount: Schema.Finite,
	employer_amount: Schema.Finite,
	/** The row of the scheme's own table the amounts were read from, where it has one. */
	band_reference: Schema.NullOr(Schema.String),
	/** Named extras a scheme charges beside its two shares, keyed by the scheme's own name for them. */
	special_amounts: Schema.Record(Schema.String, Schema.Finite)
});

export type PayslipStatutory = Schema.Schema.Type<typeof payslipStatutoryValueSchema>;

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const payslipStatutorySchema = Schema.toStandardSchemaV1(payslipStatutoryValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'payslip_statutory',
	description:
		'One statutory scheme charged on a payslip: the wage it was charged on, what it took from the employee, what it cost the employer, the band it was read from, and any named special amounts.',
	schema: payslipStatutorySchema
});
