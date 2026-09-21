// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { Effect } from 'effect';
import { matchWhere } from '../../src/lib/memory-reads.ts';

/**
 * In-memory `db` for the payroll gather and every transform a test drives. Predicates are the
 * workspace's own in-memory evaluator (`src/lib/memory-reads.ts`); `with` resolves the relations a
 * transform reads through.
 */

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

/**
 * The relations a transform reads through `with`, as the workspace declares them: the nested
 * name, the target table, and which column on which side joins them.
 */
const RELATIONS: Record<
	string,
	Record<
		string,
		{
			target: keyof PayrollWorld;
			column: string;
			parentColumn: string;
			cardinality: 'one' | 'many';
		}
	>
> = {
	employments: {
		employment_employee: {
			target: 'employees',
			column: 'employee_id',
			parentColumn: 'id',
			cardinality: 'one'
		},
		employment_company: {
			target: 'companies',
			column: 'company_id',
			parentColumn: 'id',
			cardinality: 'one'
		},
		term_employment: {
			target: 'employment_terms',
			column: 'employment_id',
			parentColumn: 'id',
			cardinality: 'many'
		}
	},
	payroll_runs: {
		payslip_payroll_run: {
			target: 'payslips',
			column: 'payroll_run_id',
			parentColumn: 'id',
			cardinality: 'many'
		}
	},
	companies: {
		company_fact_company: {
			target: 'company_facts',
			column: 'company_id',
			parentColumn: 'id',
			cardinality: 'many'
		}
	},
	payslips: {
		payslip_payroll_run: {
			target: 'payroll_runs',
			column: 'payroll_run_id',
			parentColumn: 'id',
			cardinality: 'one'
		}
	},
	claim_requests: {
		claim_request_employment: {
			target: 'employments',
			column: 'employment_id',
			parentColumn: 'id',
			cardinality: 'one'
		}
	},
	adhoc_requests: {
		adhoc_request_employment: {
			target: 'employments',
			column: 'employment_id',
			parentColumn: 'id',
			cardinality: 'one'
		}
	}
};

/**
 * A relation predicate — `{ <relation>: { some: { … } } }` — against the target rows, the way the
 * database answers it; every other key is the row's own and goes to `matchWhere`.
 */
function matchRow(
	world: PayrollWorld,
	name: keyof PayrollWorld,
	row: PayrollRow,
	where: unknown
): boolean {
	if (where == null || typeof where !== 'object') return true;
	const own: Record<string, unknown> = {};
	for (const [key, predicate] of Object.entries(where as Record<string, unknown>)) {
		const edge = RELATIONS[name]?.[key];
		if (edge == null) {
			own[key] = predicate;
			continue;
		}
		const quantified = predicate as { some?: unknown };
		const targets = (world[edge.target] ?? []).filter((target) =>
			edge.cardinality === 'one'
				? target[edge.parentColumn] === row[edge.column]
				: target[edge.column] === row[edge.parentColumn]
		);
		if (
			!targets.some((target) => matchRow(world, edge.target, target, quantified.some ?? predicate))
		)
			return false;
	}
	return matchWhere(row, own);
}

type Query = { where?: unknown; limit?: number; with?: Record<string, Query | true> };

function select(
	world: PayrollWorld,
	name: keyof PayrollWorld,
	rows: readonly PayrollRow[],
	query: Query
): PayrollRow[] {
	const matched = rows.filter((row) => matchRow(world, name, row, query.where));
	const page = query.limit == null ? matched : matched.slice(0, query.limit);
	if (query.with == null) return page;
	return page.map((row) => {
		const nested: PayrollRow = { ...row };
		for (const [relation, spec] of Object.entries(query.with ?? {})) {
			const edge = RELATIONS[name]?.[relation];
			if (edge == null) throw new Error(`memory api: ${name} has no relation ${relation}`);
			const children = select(
				world,
				edge.target,
				world[edge.target] ?? [],
				spec === true ? {} : spec
			);
			nested[relation] =
				edge.cardinality === 'one'
					? (children.find((child) => child[edge.parentColumn] === row[edge.column]) ?? null)
					: children.filter((child) => child[edge.column] === row[edge.parentColumn]);
		}
		return nested;
	});
}

/** A read-only `{ db }` whose `db` is the given world; `.db` is what a transform receives. */
export function memoryPayrollApi(world: PayrollWorld) {
	// A stored payslip always carries its `adjustments` array; a test that files one without it
	// reads it back the way the database would.
	const rows = (name: keyof PayrollWorld): readonly PayrollRow[] =>
		name === 'payslips'
			? world.payslips.map((row) => ({ adjustments: [], ...row }))
			: (world[name] ?? []);
	const collection = (name: keyof PayrollWorld) => ({
		findMany: (query: Query) => Effect.succeed(select(world, name, rows(name), query)),
		findFirst: (query: Query) => Effect.succeed(select(world, name, rows(name), query)[0]),
		count: (query: Query) => Effect.succeed(select(world, name, rows(name), query).length)
	});
	return {
		db: {
			companies: collection('companies'),
			company_facts: collection('company_facts'),
			payment_holds: collection('payment_holds'),
			jurisdiction_settings: collection('jurisdiction_settings'),
			statutory_contributions: collection('statutory_contributions'),
			loan_catalogue: collection('loan_catalogue'),
			claim_catalogue: collection('claim_catalogue'),
			adhoc_catalogue: collection('adhoc_catalogue'),
			allowance_catalogue: collection('allowance_catalogue'),
			shift_definitions: collection('shift_definitions'),
			shift_patterns: collection('shift_patterns'),
			jurisdiction_holidays: collection('jurisdiction_holidays'),
			leave_catalogue: collection('leave_catalogue'),
			leave_entries: collection('leave_entries'),
			employments: collection('employments'),
			employees: collection('employees'),
			employment_terms: collection('employment_terms'),
			employment_wage_periods: collection('employment_wage_periods'),
			employment_statutory_facts: collection('employment_statutory_facts'),
			claim_requests: collection('claim_requests'),
			adhoc_requests: collection('adhoc_requests'),
			loans: collection('loans'),
			loan_repayments: collection('loan_repayments'),
			work_days: collection('work_days'),
			rosters: collection('rosters'),
			payroll_runs: collection('payroll_runs'),
			payslips: collection('payslips')
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

/**
 * `{ db, collection }` over a world: the reads above, plus the declared writes a pipeline or a
 * function makes, applied to the world's rows. Creates get an id; updates and deletes name theirs.
 * No transform runs — this stands in for the runtime's write path, not for its rules.
 */
export function memoryWorkspaceApi(world: PayrollWorld) {
	const api = memoryPayrollApi(world);
	const rows = (name: string) => ((world as Record<string, PayrollRow[]>)[name] ??= []);
	const writer = (name: string) => ({
		create: (input: PayrollRow) =>
			Effect.sync(() => {
				const row = { id: crypto.randomUUID(), approval_id: null, ...input };
				rows(name).push(row);
				return row;
			}),
		createMany: (inputs: readonly PayrollRow[]) =>
			Effect.sync(() =>
				inputs.map((input) => {
					const row = { id: crypto.randomUUID(), approval_id: null, ...input };
					rows(name).push(row);
					return row;
				})
			),
		update: (id: string, input: PayrollRow) =>
			Effect.sync(() => {
				const stored = rows(name).find((row) => row.id === id);
				if (stored == null) throw new Error(`${name} ${id} does not exist`);
				Object.assign(stored, input);
				return stored;
			}),
		updateMany: (inputs: readonly PayrollRow[]) =>
			Effect.sync(() =>
				inputs.map(({ id, ...input }) => {
					const stored = rows(name).find((row) => row.id === id);
					if (stored == null) throw new Error(`${name} ${String(id)} does not exist`);
					Object.assign(stored, input);
					return stored;
				})
			),
		delete: (id: string) =>
			Effect.sync(() => {
				const live = rows(name);
				live.splice(0, live.length, ...live.filter((row) => row.id !== id));
			}),
		deleteMany: (ids: readonly string[]) =>
			Effect.sync(() => {
				const live = rows(name);
				live.splice(0, live.length, ...live.filter((row) => !ids.includes(row.id)));
			})
	});
	return {
		...api,
		collection: new Proxy({}, { get: (_target, name: string) => writer(name) })
	};
}
