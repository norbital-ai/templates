import type { InputFields } from '@norbital-ai/bolt';
import { employeeReference, type ExportFormat } from './export_format.js';

/** Salary listing: one row per payslip, the workbook every payroll team reconciles against. */
const schema = {
	employee_number: { kind: 'text', label: 'Employee no.' },
	employee_name: { kind: 'text', label: 'Employee' },
	currency: { kind: 'text', label: 'Currency' },
	basic_earnings: { kind: 'number', label: 'Basic salary (contract)' },
	allowances: { kind: 'number', label: 'Allowances' },
	npl: { kind: 'number', label: 'NPL' },
	proration: { kind: 'number', label: 'Proration' },
	gross_earnings: { kind: 'number', label: 'Gross pay' },
	total_deductions: { kind: 'number', label: 'Deductions' },
	net_pay: { kind: 'number', label: 'Net pay' },
	employer_cost: { kind: 'number', label: 'Employer cost' },
	bank_name: { kind: 'text', label: 'Bank' },
	bank_account_number: { kind: 'text', label: 'Account' }
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
