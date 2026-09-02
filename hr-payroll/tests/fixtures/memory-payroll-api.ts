// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { Effect } from 'effect';

/**
 * In-memory `api.db` for gather / create-before. Predicates match the engine's actual where
 * shapes (`eq`, `in`, `isNull`, inequalities, and one nested `input.kind` clause).
 */

export type PayrollRow = Record<string, unknown>;

export type PayrollWorld = {
	readonly companies: PayrollRow[];
	readonly jurisdictions: PayrollRow[];
	readonly statutory_contributions: PayrollRow[];
	readonly contribution_rates: PayrollRow[];
	readonly pay_components: PayrollRow[];
	readonly shift_definitions: PayrollRow[];
	readonly company_holidays: PayrollRow[];
	readonly leave_types: PayrollRow[];
	readonly employments: PayrollRow[];
	readonly employees: PayrollRow[];
	readonly employment_terms: PayrollRow[];
	readonly employment_statutory_facts: PayrollRow[];
	readonly component_entries: PayrollRow[];
	readonly loans: PayrollRow[];
	readonly loan_repayments: PayrollRow[];
	readonly leave_requests: PayrollRow[];
	readonly work_days: PayrollRow[];
	readonly employee_children: PayrollRow[];
	readonly payroll_runs: PayrollRow[];
	readonly payslips: PayrollRow[];
	readonly payslip_component_entry_inputs: PayrollRow[];
	readonly payslip_adjustments: PayrollRow[];
	readonly payslip_loan_repayment_inputs: PayrollRow[];
};

const OPERATORS = ['eq', 'in', 'isNull', 'lt', 'lte', 'gt', 'gte'] as const;

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
	const collection = (name: keyof PayrollWorld) => ({
		findMany: (query: { where?: unknown; limit?: number }) =>
			Effect.succeed(select(world[name], query)),
		findFirst: (query: { where?: unknown; limit?: number }) =>
			Effect.succeed(select(world[name], query)[0] ?? null)
	});
	return {
		db: {
			companies: collection('companies'),
			jurisdictions: collection('jurisdictions'),
			statutory_contributions: collection('statutory_contributions'),
			contribution_rates: collection('contribution_rates'),
			pay_components: collection('pay_components'),
			shift_definitions: collection('shift_definitions'),
			company_holidays: collection('company_holidays'),
			leave_types: collection('leave_types'),
			employments: collection('employments'),
			employees: collection('employees'),
			employment_terms: collection('employment_terms'),
			employment_statutory_facts: collection('employment_statutory_facts'),
			component_entries: collection('component_entries'),
			loans: collection('loans'),
			loan_repayments: collection('loan_repayments'),
			leave_requests: collection('leave_requests'),
			work_days: collection('work_days'),
			employee_children: collection('employee_children'),
			payroll_runs: collection('payroll_runs'),
			payslips: collection('payslips'),
			payslip_component_entry_inputs: collection('payslip_component_entry_inputs'),
			payslip_adjustments: collection('payslip_adjustments'),
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
