/**
 * Step 8 — the run's complete result, as a value.
 *
 * A `create.before` hook's return is the record the runtime persists, and it may carry the records
 * that belong to it — so the run's whole result is returned here and committed as part of the
 * run's own write: the payslips, their inlined base, proration and statutory entries, the four
 * captured-input junctions, and every adjustment that names one of those captures.
 *
 * Three consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A rebuild cannot leave half an answer.** The nested graph is the run's complete desired
 *    set of payslips, so every previous payslip is omitted and deleted (each through cascade,
 *    junctions and adjustments included) in the same statement that writes the new ones. There
 *    is no clear-then-write pair and therefore no window between the two halves.
 *  - **A child carries no `payslip_id`.** Nested under the payslip that owns it, there is no id to
 *    carry: the runtime fills the foreign key from the parent it assigned.
 *  - **A capture lands in the same statement as the figures it protects.** Source claims used to be
 *    written after the lines. In one write there is no "after".
 *
 * ## The join the two halves of the graph meet at
 *
 * MEASURE emits adjustments that name a source by family and id; the junctions this file builds
 * carry runtime-minted ids. The join is made here and nowhere else — the junction id the payslip
 * stores is the same id the adjustment's `input` handle names — which is what makes the
 * adjustment's provenance a real foreign key into a row its own payslip holds. An adjustment whose
 * causal input no junction stores is a bug to stop on, not a null to paper over.
 *
 * ## Four output planes, three of them inlined
 *
 * `base`, `proration` and `statutory` are columns on the payslip because none of them is caused by
 * a record anybody can edit: base is the contract, proration is the calendar, and statutory is
 * arithmetic over their sum. There is nothing to link to, nothing to freeze and no junction to
 * keep honest. `payslip_adjustments` is the one output relation, and every row in it names the one
 * captured input that caused it. Leave captures retain their settled outputs for exact reversals. An input
 * that prices to nothing is still a row, because "consumed nothing" and "was never read" are
 * different claims.
 *
 * Nothing here reshapes anything. MEASURE emits the stored shapes and CONTRIBUTE emits the charges;
 * this assembles them into the graph and assigns the adjustment sequence, which is the one fact
 * that only exists once a payslip's rows are in an order.
 */

import type { ContributionCharge } from './contribute.js';
import type {
	MeasuredAdjustment,
	MeasuredBase,
	MeasuredEmployment
} from '../../../lib/payroll/family.js';
import type { PayslipProration } from '../../../datatypes/payslip_proration/+definition.js';
import type { PayslipAdjustment } from '../../../datatypes/payslip_adjustments/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly termsThrough: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly proration: readonly PayslipProration[];
	readonly charges: readonly ContributionCharge[];
	/** The four captured input families, by source id — the junction rows this payslip stores. */
	readonly captured: MeasuredEmployment['captured'];
};

/**
 * The bucket an amount settles into, from the family pay item's `policy.kind` where there is one.
 *
 * `INFORMATION` never reaches here — MEASURE stops it, because an hourly rate is not money — so a
 * nature that is null or informational is a derived overtime row, and derived overtime is an
 * earning. The fallback is stated rather than left to a cast so an unexpected value lands in the
 * pot it economically belongs to instead of failing a not-null column at the database.
 */
function bucketOf(nature: MeasuredAdjustment['nature']): PayslipAdjustment['bucket'] {
	return nature == null || nature === 'INFORMATION' ? 'EARNING' : nature;
}

/** The single-use sources one payslip settled, by family — what the run stamps after the commit. */
export type PayslipCaptures = Readonly<{
	payslipId: string;
	workDays: readonly string[];
	claims: readonly string[];
	payments: readonly string[];
}>;

/** Every payslip in the run with its adjustments and multi-use captures, and what each settled. */
export function payrollRunGraph(options: {
	readonly pending: readonly PendingPayslip[];
	readonly period: string;
}) {
	const captures: PayslipCaptures[] = [];
	const rows = options.pending.map((payslip) => {
		// The id is minted here so the run's `after` hook can stamp `settled_payslip_id` on the
		// sources this payslip settled once the payslip row exists.
		const id = crypto.randomUUID();
		captures.push({
			payslipId: id,
			workDays: payslip.captured.workDays,
			claims: payslip.captured.payRequests.CLAIM,
			payments: payslip.captured.payRequests.PAYMENT
		});
		return {
			id,
			employment_id: payslip.employmentId,
			terms_through: payslip.termsThrough,
			base: payslip.settlement.base.map((item: MeasuredBase) => item.entry),
			proration: payslip.proration,
			statutory: payslip.charges.map((charge) => ({
				scheme_code: charge.contribution.row.code,
				authority: charge.contribution.row.authority,
				base_amount: charge.base,
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				band_key: charge.bandReference,
				special_amounts: charge.special
			})),
			gross: payslip.settlement.gross,
			total_deductions: payslip.settlement.totalDeductions,
			net: payslip.settlement.net,
			employer_cost: payslip.settlement.employerCost,
			currency: payslip.currency,
			adjustments: payslip.settlement.adjustments.map((adjustment: MeasuredAdjustment) => ({
				family: adjustment.input.family,
				source_id: adjustment.input.id,
				label: adjustment.label,
				bucket: bucketOf(adjustment.nature),
				amount: adjustment.amount,
				quantity: adjustment.quantity,
				rate: adjustment.rate,
				statutory_rule_key: adjustment.statutoryRuleKey
			})),
			payslip_allowance_request_input_payslip: payslip.captured.payRequests.ALLOWANCE.map(
				(sourceId) => ({
					id: crypto.randomUUID(),
					allowance_request_id: sourceId,
					// Denormalized so a refusal or a badge can name the period without a run read.
					period: options.period
				})
			),
			payslip_leave_input_payslip: payslip.captured.leave.map((capture) => ({
				...capture,
				id: crypto.randomUUID(),
				period: options.period
			})),
			// A repayment can be recovered in part and recaptured for the remainder: many payslips.
			payslip_loan_repayment_input_payslip: payslip.captured.loanRepayments.map((sourceId) => ({
				id: crypto.randomUUID(),
				loan_repayment_id: sourceId,
				period: options.period
			}))
		};
	});
	return { rows, captures };
}
