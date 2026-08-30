import {
	defineModel,
	enums,
	integer,
	numeric,
	reference,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One calculated output: one thing a payslip settled that exactly one captured input caused.
 *
 * Outputs are frozen facts and this is the one output family that is a relation, because one input
 * can produce several adjustments and each needs queryable, FK-backed provenance. Base, proration
 * and statutory are inlined on `payslips` precisely because they are caused by no record anybody
 * can edit; every row here names the one captured input link that caused it.
 *
 * ## `input` points at the captured input junction, never at the source record
 *
 * The four input families are four distinct payslip attributes, but the output is one adjustment
 * family with one causal input, so `reference()` — one real foreign key per arm plus the
 * database-enforced exclusive arc — gives the provenance in one column. The arms are the four
 * engine-owned junction collections, NOT the business sources behind them: the junction row is
 * what the run captured, and pointing an output straight at the source would create a second
 * source truth beside the junction.
 *
 * The reference cascades: an output has no meaning after the captured input link that caused it is
 * released, and deleting a draft run cascades the junctions away with its payslips.
 *
 * ## What is frozen, and why nothing here names a catalogue or a scheme row
 *
 * `label`, `bucket` and `amount` are the settled facts — a later pay-component rename or
 * archiving cannot rewrite them. Component-entry and loan-repayment inputs reach their pay
 * component through real source relationships; a work-day input reaches the rule that priced it
 * through `statutory_rule_key` plus the run's `statutory_snapshot_id`, which together identify the
 * applied rule. There is no `pay_component_id` here and no band blob: both are output provenance
 * stated as stable keys instead of unprotected ids.
 *
 * `period` is denormalized deliberately, for an access reason rather than a convenience one: the
 * refusal that stops somebody editing a settled record has to name the period that owns it, and it
 * is composed inside a `before` hook under the editing person's own subject — a supervisor has no
 * `payroll_runs` read grant, so joining through the payslip to the run would turn an explanation
 * into an access denial.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		period: text().notNull(),
		/**
		 * The one captured input link that caused this row. Required: a row with no causal input is
		 * not an adjustment, it is base, proration or statutory, and those are inlined on `payslips`.
		 *
		 * Every arm is the junction, and the junction's own restrict FKs are what lock the business
		 * source. The write hook additionally proves the selected link belongs to this row's
		 * payslip — the one invariant the FK shape alone cannot state.
		 */
		input: reference({
			WORK_DAY_INPUT: 'payslip_work_day_inputs',
			COMPONENT_ENTRY_INPUT: 'payslip_component_entry_inputs',
			LEAVE_REQUEST_INPUT: 'payslip_leave_request_inputs',
			LOAN_REPAYMENT_INPUT: 'payslip_loan_repayment_inputs'
		})
			.notNull()
			.onDelete('cascade'),
		/** The settled name of what this row paid — a component code, or the rule key that priced it. */
		label: text({ search: true }).notNull(),
		bucket: enums([
			'EARNING',
			'ABSENCE',
			'DEDUCTION',
			'NON_WAGE_PAYMENT',
			'EMPLOYER_COST'
		]).notNull(),
		/** A magnitude, never a direction. Zero is meaningful: the input was consumed and priced at nothing. */
		amount: numeric().notNull(),
		quantity: numeric(),
		rate: numeric(),
		/**
		 * The stable key of the statutory rule that priced a work-day adjustment, inside the run's
		 * statutory snapshot. Allowed only for a `WORK_DAY_INPUT` row: it is output provenance, not
		 * input data and not a second copy of the rule. Together with
		 * `payroll_runs.statutory_snapshot_id` it identifies the applied rule exactly.
		 */
		statutory_rule_key: text(),
		sequence: integer().notNull()
	},
	{
		description:
			'One calculated thing a payslip settled, caused by exactly one captured input link. The input arms are the four engine-owned input junctions; the settled label, bucket and amount are frozen so later catalogue or law changes cannot rewrite history.',
		recordLabel: ['label', 'amount'],
		icon: 'lucide:list',
		indexes: [
			{ columns: ['payslip_id'] },
			{
				columns: ['statutory_rule_key'],
				where: '"statutory_rule_key" IS NOT NULL'
			}
		]
	}
);
