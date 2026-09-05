import { refuse } from '@norbital-ai/bolt/authoring';
import { sha256Json } from '@norbital-ai/std/reckon';
import { Schema } from 'effect';
import { payslipBaseValueSchema } from '../../../datatypes/payslip_base/+definition.js';
import { payslipStatutoryValueSchema } from '../../../datatypes/payslip_statutory/+definition.js';
import type { PreparedRun, buildPayrollRun } from './engine.js';
import { cents } from './rounding.js';

type Payslip = ReturnType<typeof buildPayrollRun>['payslip_payroll_run'][number];

const cumulativeSchema = Schema.Array(
	Schema.Struct({
		employment_id: Schema.String,
		currency: Schema.String,
		gross: Schema.Finite,
		total_deductions: Schema.Finite,
		net: Schema.Finite,
		employer_cost: Schema.Finite,
		base: Schema.Array(payslipBaseValueSchema),
		statutory: Schema.Array(payslipStatutoryValueSchema),
		adjustments: Schema.Record(Schema.String, Schema.Finite)
	})
);

function adjustmentKeys(payslip: Payslip) {
	const sources = {
		WORK_DAY_INPUT: new Map(
			payslip.payslip_work_day_input_payslip.map((row) => [row.id, row.work_day_id])
		),
		COMPONENT_ENTRY_INPUT: new Map(
			payslip.payslip_component_entry_input_payslip.map((row) => [row.id, row.component_entry_id])
		),
		LEAVE_REQUEST_INPUT: new Map(
			payslip.payslip_leave_request_input_payslip.map((row) => [row.id, row.leave_request_id])
		),
		LOAN_REPAYMENT_INPUT: new Map(
			payslip.payslip_loan_repayment_input_payslip.map((row) => [row.id, row.loan_repayment_id])
		)
	};
	return (adjustment: Payslip['payslip_adjustment_payslip'][number]): string => {
		const source = sources[adjustment.input.kind].get(adjustment.input.id);
		if (source == null) refuse('A payroll adjustment has no captured source.');
		return JSON.stringify([
			adjustment.input.kind,
			source,
			adjustment.label,
			adjustment.bucket,
			adjustment.statutory_rule_key
		]);
	};
}

/** Cumulative monthly totals are the baseline for the next supplemental payment. */
export function cumulativePayroll(payslips: readonly Payslip[]) {
	return payslips.map((payslip) => {
		const adjustments: Record<string, number> = {};
		const keyOf = adjustmentKeys(payslip);
		for (const adjustment of payslip.payslip_adjustment_payslip) {
			const key = keyOf(adjustment);
			adjustments[key] = cents((adjustments[key] ?? 0) + adjustment.amount);
		}
		return {
			employment_id: payslip.employment_id,
			currency: payslip.currency,
			gross: payslip.gross,
			total_deductions: payslip.total_deductions,
			net: payslip.net,
			employer_cost: payslip.employer_cost,
			base: payslip.base,
			statutory: payslip.statutory,
			adjustments
		};
	});
}

/** Price the whole month once, then pay only the difference from the last paid cumulative result. */
export function supplementalPayroll(payslips: readonly Payslip[], captured: unknown): Payslip[] {
	const previous = Schema.decodeUnknownSync(cumulativeSchema)(captured);
	if (previous.length !== payslips.length)
		refuse('Supplemental payroll cannot change the paid population.');
	const previousByEmployment = new Map(previous.map((row) => [row.employment_id, row]));
	if (previousByEmployment.size !== previous.length)
		refuse('Duplicate employment in cumulative payroll snapshot.');
	return payslips.map((payslip) => {
		const prior = previousByEmployment.get(payslip.employment_id);
		if (prior == null || prior.currency !== payslip.currency)
			refuse('Supplemental payroll must retain the paid employment and currency.');
		const baseTotals = new Map<string, number>();
		for (const row of payslip.base)
			baseTotals.set(
				row.component_code,
				cents((baseTotals.get(row.component_code) ?? 0) + row.amount)
			);
		for (const row of prior.base)
			baseTotals.set(
				row.component_code,
				cents((baseTotals.get(row.component_code) ?? 0) - row.amount)
			);
		if ([...baseTotals.values()].some((amount) => amount !== 0))
			refuse('Supplemental payroll cannot change the paid base salary.');
		const net = cents(payslip.net - prior.net);
		if (net < 0)
			refuse(
				'Supplemental payroll cannot recover more than its new earnings. Carry the recovery to a later regular payroll.'
			);
		const deductions = new Map(Object.entries(prior.adjustments));
		const keyOf = adjustmentKeys(payslip);
		const grouped = new Map<string, Payslip['payslip_adjustment_payslip'][number]>();
		for (const row of payslip.payslip_adjustment_payslip) {
			const key = keyOf(row);
			const current = grouped.get(key);
			grouped.set(
				key,
				current == null
					? row
					: { ...current, amount: cents(current.amount + row.amount), quantity: null, rate: null }
			);
		}
		const adjustments = [...grouped].flatMap(([key, row]) => {
			const previousAmount = deductions.get(key) ?? 0;
			deductions.delete(key);
			const amount = cents(row.amount - previousAmount);
			return amount === 0 ? [] : [{ ...row, amount, quantity: null, rate: null }];
		});
		if ([...deductions.values()].some((amount) => amount !== 0))
			refuse('A supplemental payroll cannot remove a previously settled input.');
		return {
			...payslip,
			gross: cents(payslip.gross - prior.gross),
			total_deductions: cents(payslip.total_deductions - prior.total_deductions),
			net,
			employer_cost: cents(payslip.employer_cost - prior.employer_cost),
			base: [],
			proration: [],
			statutory: payslip.statutory.map((row) => {
				const paid = prior.statutory.find((charge) => charge.scheme_code === row.scheme_code);
				return {
					...row,
					base_amount: cents(row.base_amount - (paid?.base_amount ?? 0)),
					employee_amount: cents(row.employee_amount - (paid?.employee_amount ?? 0)),
					employer_amount: cents(row.employer_amount - (paid?.employer_amount ?? 0)),
					special_amounts: Object.fromEntries(
						Object.entries(row.special_amounts).map(([key, value]) => [
							key,
							cents(value - (paid?.special_amounts[key] ?? 0))
						])
					)
				};
			}),
			payslip_adjustment_payslip: adjustments
		};
	});
}

/** Persist the exact facts read, including employment terms and prior tax/loan consumption. */
export function payrollInputFacts(prepared: PreparedRun) {
	return {
		bundles: prepared.gathered.bundles,
		yearToDate: Object.fromEntries(prepared.gathered.yearToDate),
		consumedEntries: Object.fromEntries(prepared.gathered.consumedEntries),
		consumedRepayments: Object.fromEntries(prepared.gathered.consumedRepayments)
	};
}

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

function stableKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableKeys);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => [key, stableKeys(entry)])
	);
}

const economicRow = <T extends Readonly<Record<string, unknown>>>(row: T) => {
	const { created_at, updated_at, row_version, sys_period, ...facts } = row;
	return facts;
};
const rowsById = <T extends { readonly id: string }>(rows: readonly T[]) =>
	rows.toSorted((a, b) => a.id.localeCompare(b.id)).map(economicRow);

/** Supplements may add monetary entries; all other economic inputs retain their paid baseline. */
export function corePayrollInputHash(prepared: PreparedRun): string {
	const facts = payrollInputFacts(prepared);
	return sha256Json(
		stableKeys({
			...facts,
			bundles: facts.bundles
				.toSorted((a, b) => a.employment.id.localeCompare(b.employment.id))
				.map(
					({
						componentEntries,
						employee,
						terms,
						statutoryFacts,
						children,
						loans,
						loanRepayments,
						ledger,
						workDays,
						...bundle
					}) => ({
						...bundle,
						employment: economicRow(bundle.employment),
						employee: {
							id: employee.id,
							date_of_birth: employee.date_of_birth,
							gender: employee.gender,
							spouse_status: employee.spouse_status,
							dependents_count: employee.dependents_count
						},
						terms: rowsById(terms),
						statutoryFacts: rowsById(statutoryFacts),
						children: rowsById(children),
						loans: rowsById(loans),
						loanRepayments: rowsById(loanRepayments),
						ledger: rowsById(ledger),
						workDays: rowsById(workDays)
					})
				)
		})
	);
}
