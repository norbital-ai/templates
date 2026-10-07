/**
 * L-TPL-hr-payroll-137: bank payment file (OCBC FAST when the payer is OCBCSG, else CSV) plus one
 * payslip CSV per employee. Held slips and non-positive nets are omitted from the bank file.
 */
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import { isJsonObject } from './foundation.js';

const isString = Schema.is(Schema.String);

export type BankAccount = {
	readonly bank_name?: string;
	readonly bank_code?: string;
	readonly bank_account_number?: string;
	readonly bank_account_name?: string;
};

export type ExportPayment = {
	readonly employee_number: string;
	readonly name: string;
	readonly bank: BankAccount | null;
	readonly amount: string;
	readonly currency: string;
	readonly status: string;
	readonly period: string;
	readonly gross: string;
	readonly total_deductions: string;
	readonly lines: readonly { readonly component_code: string; readonly amount: string }[];
};

export type ExportDocument = { readonly name: string; readonly content: string };

export function bankAccountFrom(value: unknown): BankAccount | null {
	if (!isJsonObject(value)) return null;
	return {
		...(isString(value.bank_name) ? { bank_name: value.bank_name } : {}),
		...(isString(value.bank_code) ? { bank_code: value.bank_code } : {}),
		...(isString(value.bank_account_number)
			? { bank_account_number: value.bank_account_number }
			: {}),
		...(isString(value.bank_account_name) ? { bank_account_name: value.bank_account_name } : {})
	};
}

export function moneyText(value: unknown): string {
	if (value instanceof Decimal) return value.toString();
	if (Schema.is(Schema.Number)(value) || isString(value)) {
		try {
			return Decimal.of(value).toString();
		} catch {
			return '0';
		}
	}
	if (isJsonObject(value) && isString(value.$dec)) return moneyText(value.$dec);
	if (isJsonObject(value) && value.value != null) return moneyText(value.value);
	return '0';
}

export function payable(status: string, net: unknown): boolean {
	if (status === 'ON_HOLD') return false;
	return Decimal.of(moneyText(net)).cmp(0) > 0;
}

export function payslipLines(
	value: unknown
): { readonly component_code: string; readonly amount: string }[] {
	if (!Array.isArray(value)) return [];
	const out: { readonly component_code: string; readonly amount: string }[] = [];
	for (const row of value) {
		if (!isJsonObject(row)) continue;
		const code = isString(row.component_code)
			? row.component_code
			: isString(row.code)
				? row.code
				: '';
		if (code === '') continue;
		out.push({ component_code: code, amount: moneyText(row.amount) });
	}
	return out;
}

function csvEscape(value: string): string {
	if (!/[",\n]/.test(value)) return value;
	return `"${value.replaceAll('"', '""')}"`;
}

function csvRow(cells: readonly string[]): string {
	return cells.map(csvEscape).join(',');
}

function pad(value: string, width: number): string {
	return value.slice(0, width).padEnd(width, ' ');
}

function cents(amount: string): string {
	return Decimal.of(amount).times(100).round(0).toString().padStart(12, '0');
}

function ocbcFast(payer: BankAccount, period: string, payments: readonly ExportPayment[]): string {
	const date = period.replaceAll('-', '').slice(0, 8).padEnd(8, '0');
	const originator = pad(payer.bank_account_number ?? '', 20);
	const originatorName = pad((payer.bank_account_name ?? payer.bank_name ?? '').toUpperCase(), 35);
	const header = `0${originator}${originatorName}${date}`;
	const details = payments.map(
		(row) =>
			`1${pad(row.bank?.bank_account_number ?? '', 34)}${cents(row.amount)}${pad(row.name.toUpperCase(), 35)}${pad(row.employee_number, 16)}`
	);
	const total = payments.reduce((sum, row) => sum.plus(row.amount), Decimal.of(0));
	const trailer = `9${String(payments.length).padStart(6, '0')}${cents(total.toString()).padStart(18, '0')}`;
	return [header, ...details, trailer].join('\n');
}

function bankCsv(payments: readonly ExportPayment[]): string {
	return [
		csvRow([
			'employee_number',
			'name',
			'bank_code',
			'account',
			'account_name',
			'amount',
			'currency'
		]),
		...payments.map((row) =>
			csvRow([
				row.employee_number,
				row.name,
				row.bank?.bank_code ?? '',
				row.bank?.bank_account_number ?? '',
				row.bank?.bank_account_name ?? '',
				row.amount,
				row.currency
			])
		)
	].join('\n');
}

export function bankDocument(
	payer: BankAccount | null,
	period: string,
	payments: readonly ExportPayment[]
): ExportDocument | null {
	const rows = payments.filter((row) => payable(row.status, row.amount));
	if (rows.length === 0) return null;
	const ocbc = (payer?.bank_code ?? '').toUpperCase().startsWith('OCBCSG');
	return {
		name: ocbc ? `bank-${period}.fast.txt` : `bank-${period}.csv`,
		content: ocbc && payer != null ? ocbcFast(payer, period, rows) : bankCsv(rows)
	};
}

export function payslipDocument(row: ExportPayment): ExportDocument {
	const lines = [
		csvRow(['field', 'value']),
		csvRow(['period', row.period]),
		csvRow(['employee_number', row.employee_number]),
		csvRow(['name', row.name]),
		csvRow(['currency', row.currency]),
		csvRow(['gross', row.gross]),
		csvRow(['total_deductions', row.total_deductions]),
		csvRow(['net', row.amount]),
		csvRow(['status', row.status]),
		csvRow(['component_code', 'amount']),
		...row.lines.map((line) => csvRow([line.component_code, line.amount]))
	];
	return {
		name: `payslip-${row.employee_number}-${row.period}.csv`,
		content: lines.join('\n')
	};
}

export function payrollExportDocuments(input: {
	readonly payer: BankAccount | null;
	readonly period: string;
	readonly payments: readonly ExportPayment[];
}): ExportDocument[] {
	const bank = bankDocument(input.payer, input.period, input.payments);
	return [...(bank == null ? [] : [bank]), ...input.payments.map(payslipDocument)];
}
