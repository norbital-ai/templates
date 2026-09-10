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
 * One calculated thing a payslip settled, caused by exactly one captured input. `component_code`,
 * `label`, `bucket` and `amount` are frozen facts; a later catalogue rename cannot rewrite them.
 * The statutory rule key is work-day provenance and nothing else.
 */
export const payslipAdjustmentSchema = Schema.Struct({
	family: Schema.Literals(ADJUSTMENT_FAMILIES),
	source_id: Schema.String.check(Schema.isUUID()),
	/**
	 * The catalogue component this settled under, frozen at settlement — the same fact
	 * `payslip_base.component_code` carries, for the same reason: an export groups by the
	 * catalogue, and a line that cannot name its catalogue item cannot be grouped.
	 *
	 * It is not `label`. A derived overtime row labels itself with the statutory rule key that
	 * priced it, which is provenance rather than vocabulary; its component code is the Work
	 * catalogue's `OVERTIME` or `OVERTIME_EXCESS`, and both facts are needed — the key says which
	 * band, the code says which column.
	 */
	component_code: Schema.NonEmptyString,
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
