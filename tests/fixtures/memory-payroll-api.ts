// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { Effect } from 'effect';

/**
 * In-memory `api.db` for gather / create-before. Predicates match the engine's actual where
 * shapes (`eq`, `in`, `isNull`, `isNotNull`, inequalities, and one nested `input.kind` clause).
 */

export type PayrollRow = Record<string, unknown>;

export type PayrollWorld = {
	readonly companies: PayrollRow[];
	readonly jurisdiction_settings: PayrollRow[];
	readonly statutory_contributions: PayrollRow[];
	readonly work_catalogue: PayrollRow[];
	readonly loan_catalogue: PayrollRow[];
	readonly claim_catalogue: PayrollRow[];
	readonly allowance_catalogue: PayrollRow[];
	readonly payment_catalogue: PayrollRow[];
	readonly shift_definitions: PayrollRow[];
	readonly shift_patterns: PayrollRow[];
	readonly jurisdiction_holidays: PayrollRow[];
	readonly leave_catalogue: PayrollRow[];
	readonly leave_entries: PayrollRow[];
	readonly employments: PayrollRow[];
	readonly employees: PayrollRow[];
	readonly employment_terms: PayrollRow[];
	readonly employment_statutory_facts: PayrollRow[];
	readonly claim_requests: PayrollRow[];
	readonly allowance_requests: PayrollRow[];
	readonly payment_requests: PayrollRow[];
	readonly loans: PayrollRow[];
	readonly loan_repayments: PayrollRow[];
	readonly work_days: PayrollRow[];
	readonly payroll_runs: PayrollRow[];
	readonly payslips: PayrollRow[];
	readonly payslip_allowance_request_inputs: PayrollRow[];
	readonly payslip_leave_inputs: PayrollRow[];
	readonly payslip_loan_repayment_inputs: PayrollRow[];
};

const OPERATORS = ['eq', 'in', 'isNull', 'isNotNull', 'lt', 'lte', 'gt', 'gte'] as const;

function valuesEqual(left: unknown, right: unknown): boolean {
	return left === right || (left == null && right == null);
}

function asOrderable(value: unknown): string | number | null {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return value;
	if (value == null) return null;
	return String(value);
}

function compare(left: unknown, right: unknown): number {
	const a = asOrderable(left);
	const b = asOrderable(right);
	if (a == null || b == null) return 0;
	return a < b ? -1 : a > b ? 1 : 0;
}

function matchPredicate(value: unknown, predicate: unknown): boolean {
	if (predicate == null || typeof predicate !== 'object' || Array.isArray(predicate)) {
		return valuesEqual(value, predicate);
	}
	const clause = predicate as Record<string, unknown>;
	let sawOperator = false;
	for (const operator of OPERATORS) {
		if (!(operator in clause)) continue;
		sawOperator = true;
		switch (operator) {
			case 'eq':
				if (!valuesEqual(value, clause.eq)) return false;
				break;
			case 'in':
				if (
					!Array.isArray(clause.in) ||
					!clause.in.some((candidate) => valuesEqual(value, candidate))
				)
					return false;
				break;
			case 'isNull':
				if (Boolean(clause.isNull) !== (value == null)) return false;
				break;
			case 'isNotNull':
				if (Boolean(clause.isNotNull) !== (value != null)) return false;
				break;
			case 'lt':
				if (compare(value, clause.lt) >= 0) return false;
				break;
			case 'lte':
				if (compare(value, clause.lte) > 0) return false;
				break;
			case 'gt':
				if (compare(value, clause.gt) <= 0) return false;
				break;
			case 'gte':
				if (compare(value, clause.gte) < 0) return false;
				break;
			default: {
				const _exhaustive: never = operator;
				throw new Error(`Unhandled where operator: ${String(_exhaustive)}`);
			}
		}
	}
	if (sawOperator) return true;
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return matchWhere(value as Record<string, unknown>, predicate);
	}
	return false;
}

function matchWhere(row: Record<string, unknown>, where: unknown): boolean {
	if (where == null || typeof where !== 'object') return true;
	for (const [key, predicate] of Object.entries(where as Record<string, unknown>)) {
		if (!matchPredicate(row[key], predicate)) return false;
	}
	return true;
}

function select(rows: readonly PayrollRow[], query: { where?: unknown; limit?: number }) {
	const matched = rows.filter((row) => matchWhere(row, query.where));
	return query.limit == null ? matched : matched.slice(0, query.limit);
}

export function clonePayrollWorld(world: PayrollWorld): PayrollWorld {
	return structuredClone(world);
}

/** A read-only hook `api` whose `db` is the given world. */
export function memoryPayrollApi(world: PayrollWorld) {
	// A stored payslip always carries its `adjustments` array; a test that files one without it
	// reads it back the way the database would.
	const rows = (name: keyof PayrollWorld): readonly PayrollRow[] =>
		name === 'payslips' ? world.payslips.map((row) => ({ adjustments: [], ...row })) : world[name];
	const collection = (name: keyof PayrollWorld) => ({
		findPending: (query: { where?: unknown; limit?: number }) =>
			Effect.succeed(
				select(
					rows(name).filter((row) => row.approval_id != null),
					query
				)
			),
		findMany: (query: { where?: unknown; limit?: number }) =>
			Effect.succeed(select(rows(name), query)),
		findFirst: (query: { where?: unknown; limit?: number }) =>
			Effect.succeed(select(rows(name), query)[0] ?? null),
		/** An id updates in place; no id appends. What the run's `after` hook writes onto sources. */
		mutate: (values: readonly PayrollRow[]) =>
			Effect.sync(() => {
				for (const value of values) {
					const stored =
						value.id == null ? undefined : world[name].find((row) => row.id === value.id);
					if (stored) Object.assign(stored, value);
					else world[name].push({ ...value });
				}
			})
	});
	return {
		db: {
			companies: collection('companies'),
			jurisdiction_settings: collection('jurisdiction_settings'),
			statutory_contributions: collection('statutory_contributions'),
			work_catalogue: collection('work_catalogue'),
			loan_catalogue: collection('loan_catalogue'),
			claim_catalogue: collection('claim_catalogue'),
			allowance_catalogue: collection('allowance_catalogue'),
			payment_catalogue: collection('payment_catalogue'),
			shift_definitions: collection('shift_definitions'),
			shift_patterns: collection('shift_patterns'),
			jurisdiction_holidays: collection('jurisdiction_holidays'),
			leave_catalogue: collection('leave_catalogue'),
			leave_entries: collection('leave_entries'),
			employments: collection('employments'),
			employees: collection('employees'),
			employment_terms: collection('employment_terms'),
			employment_statutory_facts: collection('employment_statutory_facts'),
			claim_requests: collection('claim_requests'),
			allowance_requests: collection('allowance_requests'),
			payment_requests: collection('payment_requests'),
			loans: collection('loans'),
			loan_repayments: collection('loan_repayments'),
			work_days: collection('work_days'),
			payroll_runs: collection('payroll_runs'),
			payslips: collection('payslips'),
			payslip_allowance_request_inputs: collection('payslip_allowance_request_inputs'),
			payslip_leave_inputs: collection('payslip_leave_inputs'),
			payslip_loan_repayment_inputs: collection('payslip_loan_repayment_inputs')
		}
	};
}

export function refusalMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'object' && error != null && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}
