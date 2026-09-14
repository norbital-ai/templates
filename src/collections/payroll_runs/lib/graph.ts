/**
 * Step 8 — the run's complete result, as a value.
 *
 * A `create.before` hook's return is the record the runtime persists, and it may carry the records
 * that belong to it — so the run's whole result is returned here and committed as part of the
 * run's own write: the payslips with their inlined base, proration and statutory entries, plus the
 * per-period rows a standing source materialised.
 *
 * Two consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A rebuild cannot leave half an answer.** The nested graph is the run's complete desired
 *    set of payslips, so every previous payslip is omitted and deleted in the same statement that
 *    writes the new ones.
 *  - **A child carries no `payslip_id`.** Nested under the payslip that owns it, there is no id to
 *    carry: the runtime fills the foreign key from the parent it assigned.
 *
 * ## Linking the consumed inputs
 *
 * MEASURE emits adjustments that name an entry by family and id. The run's own hook then writes
 * the pins: authored entries get their `payslip_id` stamped, and per-period materialisations are
 * created with it already set. An adjustment whose source is neither is a bug to stop on.
 */

import type { ContributionCharge } from './contribute.js';
import type { MaterialisedMoney, PayRequestFamily } from '../../../lib/payroll/money.js';
import type {
	MeasuredAdjustment,
	MeasuredBase,
	MeasuredEmployment,
	SettlementBucket
} from '../../../lib/payroll/family.js';
import type { PayslipAdjustment } from '../../../datatypes/payslip_adjustments/+definition.js';
import type { PayslipProration } from '../../../datatypes/payslip_proration/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly termsThrough: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly proration: readonly PayslipProration[];
	readonly charges: readonly ContributionCharge[];
	/** The captured input families, by source id — the pins and rows this payslip stores. */
	readonly captured: MeasuredEmployment['captured'];
};

/** One entry family captured by one payslip, and the per-period rows it materialised. */
export type PayslipCaptures = Readonly<{
	payslipId: string;
	workDays: readonly string[];
	claims: readonly string[];
	payments: readonly string[];
	allowances: readonly string[];
	leave: readonly string[];
	loanRepayments: readonly string[];
	materialised: ReadonlyArray<MaterialisedMoney & { readonly payslipId: string }>;
}>;

/** Every payslip in the run with its adjustments and captures, and what each settled. */
export function payrollRunGraph(options: {
	readonly pending: readonly PendingPayslip[];
	readonly period: string;
}) {
	const captures: PayslipCaptures[] = [];
	const rows = options.pending.map((payslip) => {
		// The id is minted here so the run's hook can link every consumed source once the payslip
		// row exists.
		const id = crypto.randomUUID();
		captures.push({
			payslipId: id,
			workDays: payslip.captured.workDays,
			claims: payslip.captured.payRequests.CLAIM,
			payments: payslip.captured.payRequests.PAYMENT,
			allowances: payslip.captured.payRequests.ALLOWANCE,
			leave: payslip.captured.leave.map((capture) => capture.leave_entry_id),
			loanRepayments: payslip.captured.loanRepayments,
			materialised: payslip.captured.materialised.map((row) => ({ ...row, payslipId: id }))
		});
		return {
			id,
			employment_id: payslip.employmentId,
			terms_through: payslip.termsThrough,
			status: 'DRAFT' as const,
			base: payslip.settlement.base.map((item: MeasuredBase) => item.entry),
			proration: payslip.proration,
			statutory: payslip.charges.map((charge) => ({
				scheme_code: charge.contribution.row.code,
				authority: charge.contribution.row.authority,
				base_amount: charge.base,
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				rule_when: charge.ruleReference
			})),
			gross: payslip.settlement.gross,
			total_deductions: payslip.settlement.totalDeductions,
			net: payslip.settlement.net,
			employer_cost: payslip.settlement.employerCost,
			currency: payslip.currency,
			adjustments: payslip.settlement.adjustments.map((adjustment: MeasuredAdjustment) => ({
				family: adjustment.input.family,
				source_id: adjustment.input.id,
				component_code: adjustment.catalogueComponent.code,
				label: adjustment.label,
				bucket: adjustment.bucket,
				amount: adjustment.amount,
				quantity: adjustment.quantity,
				rate: adjustment.rate,
				statutory_rule_key: adjustment.statutoryRuleKey
			}))
		};
	});
	return {
		rows,
		captures,
		calculationTrace: options.pending.map((payslip) => ({
			employment_id: payslip.employmentId,
			employee_number: payslip.employeeNumber,
			schemes: payslip.charges.map((charge) => ({
				scheme_code: charge.contribution.row.code,
				rule_when: charge.ruleReference,
				base_amount: charge.base,
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				inputs: charge.inputs.map((line) => ({
					code: line.code,
					label: line.label,
					effect: line.effect,
					amount: line.amount
				})),
				reads: charge.reads.map((read) => ({
					code: read.code,
					employee_amount: read.employee_amount,
					employer_amount: read.employer_amount
				}))
			}))
		}))
	};
}

export type { MaterialisedMoney, PayRequestFamily, SettlementBucket, PayslipAdjustment };
