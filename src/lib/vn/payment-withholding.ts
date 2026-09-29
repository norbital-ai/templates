import { evaluateNumber, runtimeExpressionEngine } from '../expressions/evaluate.js';
import { isCalendarDate } from '../iso-day.js';
import type { PayslipStatutory } from '../datatypes/payslip_statutory.js';
import { refuse } from '../refuse.js';
import { readRange } from '../payroll/run/effective.js';
import { selectRule } from '../payroll/run/contribute.js';
import type { ContributionConfig } from '../payroll/run/configuration.js';

type Payment = {
	readonly company_id: string;
	readonly employee_id: string;
	readonly paid_on: string;
	readonly reference: string;
	readonly currency: string;
	readonly gross_amount: number;
	readonly non_event_deduction_amount: number;
	readonly cash_amount: number;
};

type Tranche = {
	readonly id: string;
	readonly settlement: { readonly collection: string; readonly id: string };
	readonly source_category: string;
	readonly source_kind: string;
	readonly source_id: string;
	readonly reference: string;
	readonly tax_treatment: 'TAXABLE' | 'EXEMPT';
	readonly currency: string;
	readonly gross_amount: number;
	readonly due_on: string;
};

type Allocation = {
	readonly gross_amount: number;
	readonly non_event_deduction_amount: number;
	readonly tranche: Tranche;
};

type TaxFacts = {
	readonly withhold_below_threshold_requested: boolean;
	readonly request_received_on?: string | null;
	readonly request_reference?: string | null;
	readonly commitment_form_reference?: string | null;
	readonly commitment_received_on?: string | null;
	readonly commitment_tax_year?: number | null;
	readonly commitment_tax_id?: string | null;
	readonly commitment_sole_income_declared?: boolean | null;
	readonly commitment_below_taxable_threshold_declared?: boolean | null;
};

export type VnPaymentWithholdingInput = {
	readonly event: Payment;
	readonly allocations: readonly Allocation[];
	readonly facts: TaxFacts;
	readonly settlement: {
		readonly id: string;
		readonly company_id: string;
		readonly employee_id: string;
		readonly currency: string;
		readonly relationship_reviewed_on: string;
		readonly relationship_reference: string;
		readonly income_nature_reference: string;
		readonly tax_residency: 'RESIDENT' | 'NON_RESIDENT';
		readonly tax_residency_range: unknown;
		readonly tax_residency_reference: string;
	};
	readonly pit: Pick<ContributionConfig['row'], 'code' | 'authority' | 'rules'>;
	/** Inclusive, normalized date range of the sealed PIT settings version. */
	readonly settingsRange: unknown;
};

/** Price one actual payment to a VN natural person with no labour contract. */
export function assessVnPaymentWithholding(
	input: VnPaymentWithholdingInput
): readonly PayslipStatutory[] {
	const { event, allocations, facts, settlement, pit } = input;
	if (pit.code !== 'PIT') refuse('Vietnam payment withholding needs the sealed PIT scheme.');
	if (!isCalendarDate(event.paid_on))
		refuse('Vietnam payment needs an actual calendar payment date.');
	if (!event.reference.trim()) refuse('Vietnam actual payment needs an evidence reference.');
	const settings = readRange(input.settingsRange);
	const residency = readRange(settlement.tax_residency_range);
	if (
		settings == null ||
		residency == null ||
		event.paid_on < settings.start.slice(0, 10) ||
		(settings.end != null && event.paid_on > settings.end.slice(0, 10)) ||
		event.paid_on < residency.start.slice(0, 10) ||
		(residency.end != null && event.paid_on > residency.end.slice(0, 10))
	)
		refuse(
			'Vietnam payment date needs a sealed PIT version and evidenced tax residence covering that day.'
		);
	if (
		event.company_id !== settlement.company_id ||
		event.employee_id !== settlement.employee_id ||
		event.currency !== 'VND' ||
		settlement.currency !== 'VND'
	)
		refuse(
			'Vietnam payment and no-contract settlement must name the same payer, payee and VND currency.'
		);
	if (
		!isCalendarDate(settlement.relationship_reviewed_on) ||
		settlement.relationship_reviewed_on > event.paid_on ||
		![
			settlement.relationship_reference,
			settlement.income_nature_reference,
			settlement.tax_residency_reference
		].every((reference) => reference.trim().length > 0)
	)
		refuse(
			'Vietnam no-contract wage classification and tax residence need dated evidence before payment.'
		);
	if (allocations.length === 0) refuse('Vietnam payment needs at least one priced allocation.');
	let gross = 0;
	let deductions = 0;
	for (const allocation of allocations) {
		const tranche = allocation.tranche;
		if (
			tranche.settlement.collection !== 'vn_noncontract_settlements' ||
			tranche.settlement.id !== settlement.id ||
			tranche.source_category !== 'NONCONTRACT_REMUNERATION' ||
			tranche.currency !== 'VND' ||
			![tranche.source_kind, tranche.source_id, tranche.reference].every(
				(value) => value.trim().length > 0
			) ||
			!isCalendarDate(tranche.due_on)
		)
			refuse(
				'Vietnam no-contract allocation needs one evidenced remuneration tranche for this settlement.'
			);
		if (tranche.tax_treatment !== 'TAXABLE')
			refuse(
				'Vietnam exempt remuneration needs an evidenced exemption category before event withholding.'
			);
		if (
			![tranche.gross_amount, allocation.gross_amount, allocation.non_event_deduction_amount].every(
				(value) => Number.isSafeInteger(value) && value >= 0
			) ||
			allocation.gross_amount <= 0 ||
			allocation.gross_amount > tranche.gross_amount ||
			allocation.non_event_deduction_amount > allocation.gross_amount
		)
			refuse('Vietnam allocation needs a positive VND gross and a valid non-event deduction.');
		gross += allocation.gross_amount;
		deductions += allocation.non_event_deduction_amount;
	}
	if (
		![event.gross_amount, event.non_event_deduction_amount, event.cash_amount].every(
			(value) => Number.isSafeInteger(value) && value >= 0
		) ||
		gross !== event.gross_amount ||
		deductions !== event.non_event_deduction_amount
	)
		refuse('Vietnam actual payment gross and non-event deductions must equal its allocations.');
	const request = facts.withhold_below_threshold_requested;
	if (request) {
		if (
			event.paid_on < '2026-07-01' ||
			settlement.tax_residency !== 'RESIDENT' ||
			!isCalendarDate(facts.request_received_on ?? '') ||
			facts.request_received_on! > event.paid_on ||
			!facts.request_reference?.trim()
		)
			refuse(
				'Vietnam below-threshold withholding request needs dated resident evidence under the July 2026 rule.'
			);
	} else if (facts.request_received_on != null || facts.request_reference != null)
		refuse('Vietnam payment request evidence must agree with its withholding request.');
	const commitment = facts.commitment_form_reference != null;
	if (commitment) {
		if (event.paid_on >= '2026-07-01')
			refuse('Vietnam July 2026 commitment waiver lacks current primary authority.');
		if (
			settlement.tax_residency !== 'RESIDENT' ||
			!facts.commitment_form_reference?.trim() ||
			!isCalendarDate(facts.commitment_received_on ?? '') ||
			facts.commitment_received_on! > event.paid_on ||
			String(facts.commitment_tax_year) !== event.paid_on.slice(0, 4) ||
			!facts.commitment_tax_id?.trim() ||
			facts.commitment_sole_income_declared !== true ||
			facts.commitment_below_taxable_threshold_declared !== true
		)
			refuse(
				'Vietnam pre-July commitment needs dated Form 08, tax ID and sole-income/threshold declarations.'
			);
	} else if (
		facts.commitment_received_on != null ||
		facts.commitment_tax_year != null ||
		facts.commitment_tax_id != null ||
		facts.commitment_sole_income_declared != null ||
		facts.commitment_below_taxable_threshold_declared != null
	)
		refuse('Vietnam commitment evidence must include its form reference.');
	if (commitment && request)
		refuse('Vietnam payment cannot combine a commitment with a withholding request.');
	const context = {
		base: gross,
		period: { pay_date: event.paid_on },
		person: {
			terms: { tax_residency: settlement.tax_residency },
			employment: {
				type: 'NO_LABOUR_CONTRACT',
				open_ended: false,
				contract_months: 0,
				exit_date: ''
			}
		},
		scheme: {
			elections: {
				commitment_form: commitment,
				withhold_below_threshold_requested: request
			}
		}
	};
	const engine = runtimeExpressionEngine();
	const rule = selectRule(pit.rules, context, engine);
	if (rule == null || (settlement.tax_residency === 'RESIDENT' && !rule.payment_occasion))
		refuse('Vietnam actual no-contract payment needs a payment-occasion PIT rule.');
	if (rule.refusal != null) refuse(`PIT: ${rule.refusal}`);
	const withheld = evaluateNumber(engine, rule.employee, context);
	const employer = evaluateNumber(engine, rule.employer, context);
	if (
		!Number.isSafeInteger(withheld) ||
		withheld < 0 ||
		employer !== 0 ||
		event.cash_amount !== gross - deductions - withheld
	)
		refuse('Vietnam payment cash must reconcile to its source deductions and computed PIT.');
	return [
		{
			scheme_code: pit.code,
			authority: pit.authority,
			base_amount: gross,
			employee_amount: withheld,
			employer_amount: 0,
			rule_when: rule.when,
			payment_occasion: true
		}
	];
}
