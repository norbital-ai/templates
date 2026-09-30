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
	/** Evidence of declared facts; a world that states none has no evidence recorded. */
	readonly fact_evidence?: PayrollRow[];
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
	'fact_evidence',
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
	rows.fact_evidence = [...rows.fact_evidence, ...copiedTermsEvidence(world)];
	return rows;
}

/**
 * Evidence is keyed by its subject row. A test that spreads one terms row into a successor of the
 * same employment copies its evidenced values; the copy carries that row's evidence for each value
 * it records unchanged and has no evidence of its own for, as recording the successor would.
 */
function copiedTermsEvidence(world: PayrollWorld): PayrollRow[] {
	const evidence = world.fact_evidence ?? [];
	const subjectOf = (row: PayrollRow) => row.subject as { collection: string; id: string };
	const rows = world.employment_terms ?? [];
	const terms = new Map(rows.map((row) => [String(row.id), row]));
	const has = new Set(
		evidence.map((row) => `${subjectOf(row).collection}:${subjectOf(row).id}:${row.fact_key}`)
	);
	return rows.flatMap((row) =>
		evidence.flatMap((source) => {
			const from = terms.get(subjectOf(source).id);
			const key = String(source.fact_key);
			const facts = (row.facts ?? {}) as Record<string, unknown>;
			if (
				subjectOf(source).collection !== 'employment_terms' ||
				from == null ||
				from === row ||
				from.employment_id !== row.employment_id ||
				!Object.hasOwn(facts, key) ||
				facts[key] !== ((from.facts ?? {}) as Record<string, unknown>)[key] ||
				has.has(`employment_terms:${row.id}:${key}`)
			)
				return [];
			has.add(`employment_terms:${row.id}:${key}`);
			return [
				{
					...source,
					id: `${source.id}:${row.id}`,
					subject: { collection: 'employment_terms', id: row.id }
				}
			];
		})
	);
}

export function refusalMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'object' && error != null && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}
