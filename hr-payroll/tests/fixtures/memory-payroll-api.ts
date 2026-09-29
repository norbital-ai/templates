// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** The rows a payroll test builds, and the engine's world over them. */

export type PayrollRow = Record<string, unknown>;

export type PayrollWorld = {
	readonly companies: PayrollRow[];
	/** Dated entity fact revisions; a world that states none has only the current record. */
	readonly company_facts?: PayrollRow[];
	/** Disbursement holds; a world that states none holds nothing. */
	readonly payment_holds?: PayrollRow[];
	readonly jurisdiction_settings: PayrollRow[];
	readonly statutory_contributions: PayrollRow[];
	readonly loan_catalogue: PayrollRow[];
	readonly claim_catalogue: PayrollRow[];
	/** The ad hoc classes; a world that states none has no one-off pay. */
	readonly adhoc_catalogue?: PayrollRow[];
	readonly allowance_catalogue: PayrollRow[];
	readonly shift_definitions: PayrollRow[];
	readonly shift_patterns: PayrollRow[];
	readonly jurisdiction_holidays: PayrollRow[];
	readonly leave_catalogue: PayrollRow[];
	readonly leave_entries: PayrollRow[];
	readonly employments: PayrollRow[];
	readonly employees: PayrollRow[];
	readonly employment_terms: PayrollRow[];
	/** Reference wage periods; a world that states none has no stored wage history. */
	readonly employment_wage_periods?: PayrollRow[];
	/** Recorded stays; a world that states none records no presence. */
	readonly presence_periods?: PayrollRow[];
	readonly employment_statutory_facts: PayrollRow[];
	readonly claim_requests: PayrollRow[];
	readonly adhoc_requests?: PayrollRow[];
	readonly loans: PayrollRow[];
	readonly loan_repayments: PayrollRow[];
	readonly work_days: PayrollRow[];
	/** Rosters of record; a world that states none has no rostered cycle. */
	readonly rosters?: PayrollRow[];
	readonly payroll_runs: PayrollRow[];
	readonly payslips: PayrollRow[];
};

const COLLECTIONS = [
	'companies',
	'company_facts',
	'jurisdiction_settings',
	'statutory_contributions',
	'loan_catalogue',
	'claim_catalogue',
	'adhoc_catalogue',
	'allowance_catalogue',
	'shift_definitions',
	'shift_patterns',
	'jurisdiction_holidays',
	'leave_catalogue',
	'leave_entries',
	'employments',
	'employees',
	'employment_terms',
	'employment_wage_periods',
	'presence_periods',
	'employment_statutory_facts',
	'claim_requests',
	'adhoc_requests',
	'loans',
	'loan_repayments',
	'work_days',
	'rosters',
	'payroll_runs',
	'payslips'
] as const;

/** The engine's world over a test's rows: an absent collection is empty. */
export function payrollWorld(world: PayrollWorld) {
	const rows = Object.fromEntries(
		COLLECTIONS.map((name) => [name, (world as Record<string, PayrollRow[]>)[name] ?? []])
	);
	// A stored payslip always carries its `adjustments` array; a test that files one without it
	// reads it back the way the database would.
	rows.payslips = world.payslips.map((row) => ({ adjustments: [], ...row }));
	return rows;
}

export function refusalMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'object' && error != null && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}
