import type { InputFields } from '@norbital-ai/bolt';
import { fixed, money, type ExportFormat } from './export_format.js';

const schema = { line: { kind: 'text', label: 'Record' } } as const satisfies InputFields;

/**
 * OCBC FAST bulk credit, one fixed-width detail line per payment.
 * shortcut: field widths are the template defaults; verify them against OCBC's current FAST file specification before production use.
 */
export const ocbcFast = {
	parser: ['txt'] as const,
	schema,
	records: (rows) =>
		rows.map((row) => ({
			line: [
				fixed('D', 1),
				fixed(row.bank_code, 8),
				fixed(row.bank_account_number, 20),
				money(row.net_pay, 15),
				fixed(row.employee_name, 40),
				fixed(row.employee_number, 20),
				fixed(row.currency, 3)
			].join('')
		}))
} satisfies ExportFormat;

/** Metro Bank bulk payment, one fixed-width detail line per payment. */
export const metroBank = {
	parser: ['txt'] as const,
	schema,
	records: (rows) =>
		rows.map((row) => ({
			line: [
				fixed('PAY', 3),
				fixed(row.bank_code, 4),
				fixed(row.bank_account_number, 18),
				money(row.net_pay, 12),
				fixed(row.bank_account_name.toUpperCase(), 30),
				fixed(row.employee_number, 12)
			].join('')
		}))
} satisfies ExportFormat;
