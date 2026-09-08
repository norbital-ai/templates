import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** The input families a payslip settles; the provenance of every adjustment is family + source id. */
export const ADJUSTMENT_FAMILIES = [
	'WORK_DAY',
	'CLAIM',
	'ALLOWANCE',
	'PAYMENT',
	'LEAVE',
	'LOAN_REPAYMENT'
] as const;

/**
 * One calculated thing a payslip settled, caused by exactly one captured input. `label`, `bucket`
 * and `amount` are frozen facts; a later catalogue rename cannot rewrite them. The statutory rule
 * key is work-day provenance and nothing else.
 */
export const payslipAdjustmentSchema = Schema.Struct({
	family: Schema.Literals(ADJUSTMENT_FAMILIES),
	source_id: Schema.String.check(Schema.isUUID()),
	label: Schema.String,
	bucket: Schema.Literals(['EARNING', 'ABSENCE', 'DEDUCTION', 'NON_WAGE_PAYMENT', 'EMPLOYER_COST']),
	/** A magnitude, never a direction. Zero is meaningful: the input was consumed and priced at nothing. */
	amount: Schema.Finite,
	quantity: Schema.NullOr(Schema.Finite),
	rate: Schema.NullOr(Schema.Finite),
	statutory_rule_key: Schema.NullOr(Schema.String)
}).check(
	Schema.makeFilter(
		(row) =>
			row.statutory_rule_key == null ||
			row.family === 'WORK_DAY' ||
			'A statutory rule key is provenance of a work-day adjustment only.'
	)
);

export type PayslipAdjustment = Schema.Schema.Type<typeof payslipAdjustmentSchema>;

export default defineCustomType({
	name: 'payslip_adjustments',
	description:
		'The adjustments of one payslip in settlement order: each caused by exactly one captured input, named by family and source id, with its frozen label, bucket and amount.',
	schema: Schema.toStandardSchemaV1(Schema.Array(payslipAdjustmentSchema), {
		parseOptions: { onExcessProperty: 'error' }
	})
});
