import type { InputFields } from '@norbital-ai/bolt';
import { employeeReference, type ExportFormat } from './export_format.js';

/** Salary listing: one row per payslip, the workbook every payroll team reconciles against. */
const schema = {
	employee_number: { kind: 'text' },
	employee_name: { kind: 'text' },
	currency: { kind: 'text' },
	basic_earnings: { kind: 'number' },
	allowances: { kind: 'number' },
	npl: { kind: 'number' },
	proration: { kind: 'number' },
	gross_earnings: { kind: 'number' },
	total_deductions: { kind: 'number' },
	net_pay: { kind: 'number' },
	employer_cost: { kind: 'number' },
	bank_name: { kind: 'text' },
	bank_account_number: { kind: 'text' }
} as const satisfies InputFields;

export const salaryListing = {
	parser: ['xlsx'] as const,
	schema,
	records: (rows) =>
		rows.map((row) => ({
			employee_number: employeeReference(row.employee_number, row.entity_name),
			employee_name: row.employee_name,
			currency: row.currency,
			basic_earnings: row.basic_earnings,
			allowances: row.allowances,
			npl: row.npl,
			proration: row.proration,
			gross_earnings: row.gross_earnings,
			total_deductions: row.total_deductions,
			net_pay: row.net_pay,
			employer_cost: row.employer_cost,
			bank_name: row.bank_name,
			bank_account_number: row.bank_account_number
		}))
} satisfies ExportFormat;
