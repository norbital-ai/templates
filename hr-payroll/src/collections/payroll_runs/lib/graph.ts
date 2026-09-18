/**
 * Step 8 — the run's complete result, as a value.
 *
 * The run's transform returns the record the runtime persists, and it may carry the records that
 * belong to it — so the run's whole result is returned here and committed as part of the run's
 * own write: the payslips with their inlined base, proration and statutory entries, the pins on
 * every source each payslip consumed, and the per-period rows a standing source materialised.
 *
 * Two consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A build cannot leave half an answer.** The run, its payslips and their pins are one
 *    payload and one transaction; a build that dies leaves no run row with no payslips under it.
 *  - **A child carries no `payslip_id`.** Nested under the payslip that owns it, there is no id to
 *    carry: the runtime fills the foreign key from the parent it assigned, and a `link` action
 *    stamps it on a source that already exists. Deleting a draft slip takes its allowance entries
 *    with it (the cascade) and releases every pin (the runtime nulls them as it deletes).
 *
 * ## Linking the consumed inputs
 *
 * MEASURE emits adjustments that name an entry by family and id. `payrollRunPayload` turns each
 * payslip's captures into relation actions on the slip: authored entries are `link`ed (their
 * `payslip_id` stamped), and allowance entries are `create`d under it with the pin already set.
 * An adjustment whose source is neither is a bug to stop on.
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

/** One entry family captured by one payslip, and the allowance entries it materialised. */
type PayslipCaptures = Readonly<{
	payslipId: string;
	workDays: readonly string[];
	claims: readonly string[];
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
		// The id is minted here so the payload can name the payslip on every source it links and
		// on every row it materialises under it.
		const id = crypto.randomUUID();
		captures.push({
			payslipId: id,
			workDays: payslip.captured.workDays,
			claims: payslip.captured.payRequests.CLAIM,
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
				label: charge.contribution.row.short_name ?? null,
				listing_order: charge.contribution.row.listing_order ?? null,
				listing_group: charge.contribution.row.listing_group ?? null,
				base_amount: charge.base,
				...(charge.ordinary == null ? {} : { ordinary_amount: charge.ordinary }),
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				directed_amount: charge.directed,
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
				...(charge.ordinary == null ? {} : { ordinary_amount: charge.ordinary }),
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

/** One relation's `link` actions, or nothing when the payslip consumed no row of that family. */
const linkActions = (ids: readonly string[]) =>
	ids.length === 0 ? {} : { link: ids.map((id) => ({ id })) };

/**
 * The payslips as nested `create` entries of the run, each carrying its captures as relation
 * actions: `link` on the sources it consumed, `create` for the allowance entries it materialised.
 */
export function payrollRunPayload(built: {
	readonly payslip_payroll_run: ReturnType<typeof payrollRunGraph>['rows'];
	readonly captures: readonly PayslipCaptures[];
}) {
	const captureOf = new Map(built.captures.map((capture) => [capture.payslipId, capture]));
	return built.payslip_payroll_run.map((row) => {
		const capture = captureOf.get(row.id);
		if (capture == null) throw new Error(`Payslip ${row.id} was built without its captures.`);
		const materialised = capture.materialised.map((entry) => ({ id: entry.id, ...entry.values }));
		return {
			...row,
			work_day_payslip: linkActions(capture.workDays),
			claim_request_payslip: linkActions(capture.claims),
			...(materialised.length === 0 ? {} : { allowance_entry_payslip: { create: materialised } }),
			leave_entry_payslip: linkActions(capture.leave),
			loan_repayment_payslip: linkActions(capture.loanRepayments)
		};
	});
}

export type { MaterialisedMoney, PayRequestFamily, SettlementBucket, PayslipAdjustment };
