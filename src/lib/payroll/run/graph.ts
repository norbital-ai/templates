/**
 * Step 8 — the run's complete result, as a value, committed as part of the run's own write: the
 * payslips with their inlined base, proration and statutory entries, and a `link` (the pin,
 * `payslip_id`) on every source each consumed. One transaction, so a build cannot leave half an
 * answer; deleting a draft slip releases its pins. An adjustment whose source is not an authored
 * entry is a bug to stop on.
 */

import type { ContributionCharge } from './contribute.js';
import { dateKey } from '../../../lib/iso-day.js';
import type { PayRequestFamily } from '../../../lib/payroll/money.js';
import type {
	MeasuredAdjustment,
	MeasuredBase,
	MeasuredEmployment,
	SettlementBucket
} from '../../../lib/payroll/family.js';
import type { PayslipAdjustment } from '../../../lib/datatypes/payslip_adjustments.js';
import type { PayslipProration } from '../../../lib/datatypes/payslip_proration.js';
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
	readonly settledOvertimeHours?: MeasuredEmployment['settledOvertimeHours'] | undefined;
	readonly inLieuSlices?: MeasuredEmployment['inLieuSlices'] | undefined;
	readonly overtimeDays?: number | undefined;
	readonly minimumWage?: number | undefined;
};

/** The sources one payslip captured, by family. */
type PayslipCaptures = Readonly<{
	payslipId: string;
	workDays: readonly string[];
	claims: readonly string[];
	adhoc: readonly string[];
	leave: readonly string[];
	loanRepayments: readonly string[];
	wagePeriods: readonly string[];
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
			adhoc: payslip.captured.payRequests.ADHOC,
			leave: payslip.captured.leave.map((capture) => capture.leave_entry_id),
			loanRepayments: payslip.captured.loanRepayments,
			wagePeriods: payslip.captured.wagePeriods
		});
		return {
			id,
			employment_id: payslip.employmentId,
			terms_through: dateKey(payslip.termsThrough),
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
				assessment_frequency: charge.assessmentFrequency,
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				directed_amount: charge.directed,
				rebate_amount: charge.rebate ?? 0,
				rule_when: charge.ruleReference,
				...(charge.ruleReference != null &&
				charge.contribution.row.rules.some(
					(rule) => rule.when === charge.ruleReference && rule.payment_occasion
				)
					? { payment_occasion: true }
					: {}),
				...(charge.remittanceRounding == null
					? {}
					: { remittance_rounding: charge.remittanceRounding })
			})),
			gross: payslip.settlement.gross,
			total_deductions: payslip.settlement.totalDeductions,
			net: payslip.settlement.net,
			unfunded_contributions: payslip.settlement.unfundedContributions,
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
			overtime_hours: [...(payslip.settledOvertimeHours ?? [])].flatMap(([limit, byMonth]) =>
				[...byMonth].map(([month, hours]) => ({ limit, month, hours }))
			),
			...((payslip.inLieuSlices ?? []).length === 0
				? {}
				: { time_off_in_lieu: [...(payslip.inLieuSlices ?? [])] }),
			...(payslip.overtimeDays
				? { overtime_days: payslip.overtimeDays, minimum_wage: payslip.minimumWage ?? 0 }
				: {}),
			schemes: payslip.charges.map((charge) => ({
				scheme_code: charge.contribution.row.code,
				rule_when: charge.ruleReference,
				...(charge.firstContributionDueOn == null
					? {}
					: { first_contribution_due_on: charge.firstContributionDueOn }),
				base_amount: charge.base,
				...(charge.ordinary == null ? {} : { ordinary_amount: charge.ordinary }),
				assessment_frequency: charge.assessmentFrequency,
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
					...(read.ordinary_employee_amount == null
						? {}
						: {
								ordinary_employee_amount: read.ordinary_employee_amount
							}),
					employer_amount: read.employer_amount
				}))
			}))
		}))
	};
}

/** One relation's `link` actions, or nothing when the payslip consumed no row of that family. */
const linkActions = (ids: readonly string[]) => (ids.length === 0 ? undefined : { link: ids });

/**
 * The payslips as nested `create` entries of the run, each carrying its captures as relation actions on the
 * slip: `link` on the sources it consumed (their `payslip_id` stamped, released by `setNull` when the draft slip
 * goes) and a `payslip_wage_periods` row per wage period it priced. The id minted for the captures stays here: a
 * nested create names its children through the relation.
 */
export function payrollRunPayload(built: {
	readonly payslip_payroll_run: ReturnType<typeof payrollRunGraph>['rows'];
	readonly captures: readonly PayslipCaptures[];
}) {
	const captureOf = new Map(built.captures.map((capture) => [capture.payslipId, capture]));
	return built.payslip_payroll_run.map(({ id, ...row }) => {
		const capture = captureOf.get(id);
		if (capture == null) throw new Error(`Payslip ${id} was built without its captures.`);
		const relations = {
			work_days: linkActions(capture.workDays),
			claim_requests: linkActions(capture.claims),
			adhoc_requests: linkActions(capture.adhoc),
			leave_entries: linkActions(capture.leave),
			loan_repayments: linkActions(capture.loanRepayments),
			payslip_wage_periods:
				capture.wagePeriods.length === 0
					? undefined
					: { create: capture.wagePeriods.map((wage_period_id) => ({ wage_period_id })) }
		};
		return {
			...row,
			...Object.fromEntries(Object.entries(relations).filter(([, action]) => action !== undefined))
		};
	});
}

export type { PayRequestFamily, SettlementBucket, PayslipAdjustment };
