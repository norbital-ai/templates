// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { Effect } from 'effect';

/**
 * A database double whose surface is exactly the reads the `work_days` transform makes, and
 * nothing wider: a broader fake is a second, silently divergent description of the read api.
 *
 * Every employment belongs to `co-1`, whose lineage `TEST` has one sealed version; the caller
 * supplies the runs, payslips, leave, terms, codes, patterns, days and rosters the case is about.
 */
export const VERSION = {
	id: 'settings-1',
	code: 'TEST',
	name: 'Test version',
	jurisdiction_code: 'TEST-JUR',
	sealed_at: '2020-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { start: '2020-01-01T00:00:00.000Z', end: null },
	work_rules: null
};

export function workDayDb({
	runs = [],
	payslips = [],
	leave = [],
	terms = [],
	days = [],
	codes = [],
	patterns = [],
	rosters = [],
	versions = [VERSION],
	employees = null
} = {}) {
	const within = (where, column, rows) => {
		const wanted = where?.[column]?.in;
		return wanted === undefined ? rows : rows.filter((row) => wanted.includes(row[column]));
	};
	return {
		employments: {
			findMany: ({ where }) =>
				Effect.succeed(
					(employees ?? where?.id?.in ?? ['emp-1']).map((id) => ({
						id,
						company_id: 'co-1',
						employee_number: id,
						employment_company: { id: 'co-1', settings_code: 'TEST' }
					}))
				)
		},
		employment_terms: {
			findMany: ({ where }) => Effect.succeed(within(where, 'employment_id', terms))
		},
		work_days: { findMany: ({ where }) => Effect.succeed(within(where, 'employment_id', days)) },
		rosters: { findMany: ({ where }) => Effect.succeed(within(where, 'employment_id', rosters)) },
		shift_definitions: { findMany: () => Effect.succeed(codes) },
		shift_patterns: { findMany: () => Effect.succeed(patterns) },
		jurisdiction_settings: { findMany: () => Effect.succeed(versions) },
		payroll_runs: { findMany: () => Effect.succeed(runs) },
		payslips: { findMany: () => Effect.succeed(payslips) },
		leave_entries: { findMany: () => Effect.succeed(leave) }
	};
}
