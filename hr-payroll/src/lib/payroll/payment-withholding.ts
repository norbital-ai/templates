import { evaluateNumber, runtimeExpressionEngine } from '../expressions/evaluate.js';
import { isCalendarDate } from '../iso-day.js';
import type { PayslipStatutory } from '../datatypes/payslip_statutory.js';
import { refuse } from '../refuse.js';
import { readRange } from './run/effective.js';
import { selectRule } from './run/contribute.js';
import { cents, fromMinorUnits, toMinorUnits } from './run/rounding.js';
import type { ContributionConfig } from './run/configuration.js';

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

export type Settlement = {
	readonly id: string;
	readonly company_id: string;
	readonly employee_id: string;
	readonly currency: string;
	readonly tax_residency: 'RESIDENT' | 'NON_RESIDENT';
	readonly tax_residency_range: unknown;
	readonly facts?: Readonly<Record<string, unknown>> | null;
};

export type PaymentWithholdingInput = {
	readonly event: Payment;
	readonly allocations: readonly Allocation[];
	/** The payment's declared facts (`payment_facts`), resolved with their typed blanks: `scheme.elections`. */
	readonly facts: Readonly<Record<string, string | number | boolean>>;
	readonly settlement: Settlement;
	/** The scheme `payroll.payment_occasion_scheme` names in the version governing the paid-on day. */
	readonly scheme: Pick<ContributionConfig['row'], 'code' | 'authority' | 'rules'>;
	/** Inclusive, normalized date range of that sealed version. */
	readonly settingsRange: unknown;
	/** That version's `payroll.currency`. */
	readonly settingsCurrency: string;
};

/**
 * The `payment` site: one actual payment and the obligation it settles. A payment of payslips
 * settles no obligation row, so its settlement is blank.
 */
export function paymentSite(
	payment: {
		readonly kind: string;
		readonly paid_on: string;
		readonly currency: string;
		readonly facts: Readonly<Record<string, unknown>>;
		readonly fact_keys: readonly string[];
	},
	settlement?: {
		readonly tax_residency: string;
		readonly facts: Readonly<Record<string, unknown>>;
		readonly fact_keys: readonly string[];
	} | null
) {
	return { payment, settlement: settlement ?? { tax_residency: '', facts: {}, fact_keys: [] } };
}

/** Price one actual payment of a non-contract settlement under the payment-occasion scheme. */
export function assessPaymentWithholding(
	input: PaymentWithholdingInput
): readonly PayslipStatutory[] {
	const { event, allocations, facts, settlement, scheme, settingsCurrency: currency } = input;
	if (!isCalendarDate(event.paid_on)) refuse('A payment needs an actual calendar payment date.');
	if (!event.reference.trim()) refuse('An actual payment needs an evidence reference.');
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
			'The payment date needs a sealed payment-occasion scheme version and evidenced tax residence covering that day.'
		);
	if (
		event.company_id !== settlement.company_id ||
		event.employee_id !== settlement.employee_id ||
		event.currency !== currency ||
		settlement.currency !== currency
	)
		refuse(
			`The payment and its non-contract settlement must name the same payer, payee and the settings currency ${currency}.`
		);
	if (allocations.length === 0) refuse('A payment needs at least one priced allocation.');
	const amount = (value: number) =>
		Number.isFinite(value) && value >= 0 && cents(value, currency) === value;
	let gross = 0n;
	let deductions = 0n;
	for (const allocation of allocations) {
		const tranche = allocation.tranche;
		if (
			tranche.settlement.collection !== 'noncontract_settlements' ||
			tranche.settlement.id !== settlement.id ||
			tranche.source_category !== 'NONCONTRACT_REMUNERATION' ||
			tranche.currency !== currency ||
			![tranche.source_kind, tranche.source_id, tranche.reference].every(
				(value) => value.trim().length > 0
			) ||
			!isCalendarDate(tranche.due_on)
		)
			refuse(
				'A non-contract allocation needs one evidenced remuneration tranche for this settlement.'
			);
		if (tranche.tax_treatment !== 'TAXABLE')
			refuse(
				'Exempt non-contract remuneration needs an evidenced exemption category before event withholding.'
			);
		if (
			![tranche.gross_amount, allocation.gross_amount, allocation.non_event_deduction_amount].every(
				amount
			) ||
			allocation.gross_amount <= 0 ||
			allocation.gross_amount > tranche.gross_amount ||
			allocation.non_event_deduction_amount > allocation.gross_amount
		)
			refuse('An allocation needs a positive gross and a valid non-event deduction.');
		gross += toMinorUnits(allocation.gross_amount, currency);
		deductions += toMinorUnits(allocation.non_event_deduction_amount, currency);
	}
	if (
		![event.gross_amount, event.non_event_deduction_amount, event.cash_amount].every(amount) ||
		gross !== toMinorUnits(event.gross_amount, currency) ||
		deductions !== toMinorUnits(event.non_event_deduction_amount, currency)
	)
		refuse('The payment gross and non-event deductions must equal its allocations.');
	const base = fromMinorUnits(gross, currency);
	const context = {
		base,
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
		scheme: { elections: facts }
	};
	const engine = runtimeExpressionEngine();
	const rule = selectRule(scheme.rules, context, engine);
	if (rule == null || (settlement.tax_residency === 'RESIDENT' && !rule.payment_occasion))
		refuse(`A non-contract payment needs a payment-occasion ${scheme.code} rule.`);
	if (rule.refusal != null) refuse(`${scheme.code}: ${rule.refusal}`);
	const withheld = evaluateNumber(engine, rule.employee, context);
	const employer = evaluateNumber(engine, rule.employer, context);
	if (
		!amount(withheld) ||
		employer !== 0 ||
		toMinorUnits(event.cash_amount, currency) !==
			gross - deductions - toMinorUnits(withheld, currency)
	)
		refuse(`The payment cash must reconcile to its source deductions and computed ${scheme.code}.`);
	return [
		{
			scheme_code: scheme.code,
			authority: scheme.authority,
			base_amount: base,
			employee_amount: withheld,
			employer_amount: 0,
			rule_when: rule.when,
			payment_occasion: true
		}
	];
}
