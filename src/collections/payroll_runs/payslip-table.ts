import { formatNumeric } from '../../lib/ui/display-formatters.js';

type PayslipAmountColumn =
	'gross' | 'total_deductions' | 'net' | 'unfunded_contributions' | 'employer_cost';

export interface PayrollRunPayslipRow {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly employment_id: string;
	readonly currency: string;
	/** The raw column is a string; the status badge reads the three known states from it. */
	readonly status: string;
	readonly paid_at: string | null;
	readonly gross: unknown;
	readonly total_deductions: unknown;
	readonly net: unknown;
	readonly unfunded_contributions: unknown;
	readonly employer_cost: unknown;
	readonly payslip_employment?: { readonly employee_number?: string | null } | null;
}

/**
 * The complete projection the payroll-run collection table renders.
 *
 * Keeping it explicit prevents a relation-only projection from leaving the four stored totals out
 * of the row and painting placeholders for money that is present on the payslip. `status` and
 * `paid_at` ride along because the per-slip actions read them to decide which transition to offer.
 */
export function payrollRunPayslipsQuery(payrollRunId: string) {
	return {
		where: { payroll_run_id: { eq: payrollRunId } },
		columns: {
			id: true,
			payroll_run_id: true,
			employment_id: true,
			currency: true,
			status: true,
			paid_at: true,
			gross: true,
			total_deductions: true,
			net: true,
			unfunded_contributions: true,
			employer_cost: true,
			created_at: true
		},
		orderBy: { created_at: 'asc' },
		with: {
			payslip_employment: { columns: { id: true, employee_number: true } }
		},
		limit: 500
	} as const;
}

/** The Employee column names the employment, never the `payslips` collection or its UUID. */
export function payslipEmployeeCode(row: PayrollRunPayslipRow): string {
	return row.payslip_employment?.employee_number || '—';
}

/** Numeric database columns arrive as decimal strings and must retain two visible decimal places. */
export function payslipAmount(row: PayrollRunPayslipRow, column: PayslipAmountColumn): string {
	return formatNumeric(row[column]);
}
