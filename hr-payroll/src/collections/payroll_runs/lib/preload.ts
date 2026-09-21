/**
 * Everything one run reads, in two concurrent waves (RFC §5.3).
 *
 * The transform's `db` allows two read waves: one keyed by the inputs, one keyed by the first's
 * answers. The engine's gather asks its questions in a dozen dependent steps, each shaped by the
 * answers before it, so the questions are not re-ordered: the rows they could ever need are read
 * here — wave 1 by the company and period, wave 2 by the people, the window and the lineage the
 * first wave named — and the engine then asks the same questions of the in-memory world
 * (`lib/memory-reads.ts`). Reads that need nothing but the company reach into the people through
 * the employment relation, so the money families are already in hand when the window is known.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { MemoryRow, MemoryWorld } from '../../../lib/memory-reads.js';
import { PAGE_LIMIT, type PayrollReadApi } from './api.js';
import { monthBounds, monthKey, shiftPeriod } from './dates.js';
import { periodGrammarFault, resolveWindow } from './period.js';
import { addDays } from '../../../lib/period.js';
import { dayInstant } from '../../../lib/iso-day.js';

const APPROVED = { approval_id: { isNull: true } } as const;

type Wave1 = Readonly<{
	companies: ReadonlyArray<MemoryRow>;
	jurisdiction_settings: ReadonlyArray<MemoryRow>;
	shift_definitions: ReadonlyArray<MemoryRow>;
	shift_patterns: ReadonlyArray<MemoryRow>;
	employments: ReadonlyArray<MemoryRow>;
	payroll_runs: ReadonlyArray<MemoryRow>;
	claim_requests: ReadonlyArray<MemoryRow>;
	adhoc_requests: ReadonlyArray<MemoryRow>;
}>;

const complete = <T>(rows: readonly T[], what: string): readonly T[] => {
	if (rows.length >= PAGE_LIMIT)
		refuse(
			`Payroll reached its ${PAGE_LIMIT.toLocaleString('en')}-row ceiling loading ${what}. ` +
				'The complete input must be loaded before this payroll can be calculated.'
		);
	return rows;
};

/** Wave 1: what the company and the period alone can name. */
const readWave1 = (db: PayrollReadApi['db'], companyId: string): Effect.Effect<Wave1> =>
	Effect.map(
		Effect.all(
			[
				db.companies.findMany({ where: { id: { eq: companyId }, ...APPROVED }, limit: 100 }),
				db.jurisdiction_settings.findMany({ where: APPROVED, limit: PAGE_LIMIT }),
				db.shift_definitions.findMany({
					where: { company_id: { eq: companyId }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.shift_patterns.findMany({
					where: { company_id: { eq: companyId }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.employments.findMany({
					where: { company_id: { eq: companyId }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.payroll_runs.findMany({ where: { company_id: { eq: companyId } }, limit: PAGE_LIMIT }),
				// The money families reach the people through the employment relation, so their
				// consumption history (a pinned claim or ad hoc request) is in hand by wave 2.
				db.claim_requests.findMany({
					where: { claim_request_employment: { some: { company_id: { eq: companyId } } } },
					limit: PAGE_LIMIT
				}),
				db.adhoc_requests.findMany({
					where: { adhoc_request_employment: { some: { company_id: { eq: companyId } } } },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		),
		([
			companies,
			jurisdiction_settings,
			shift_definitions,
			shift_patterns,
			employments,
			payroll_runs,
			claim_requests,
			adhoc_requests
		]) => ({
			companies: complete(companies, 'companies'),
			jurisdiction_settings: complete(jurisdiction_settings, 'jurisdiction settings'),
			shift_definitions: complete(shift_definitions, 'shift definitions'),
			shift_patterns: complete(shift_patterns, 'shift patterns'),
			employments: complete(employments, 'employments'),
			payroll_runs: complete(payroll_runs, 'payroll runs'),
			claim_requests: complete(claim_requests, 'claim requests'),
			adhoc_requests: complete(adhoc_requests, 'ad hoc requests')
		})
	);

/** Wave 2: what the people, the window and the lineage of wave 1 name. */
const readWave2 = (
	db: PayrollReadApi['db'],
	companyId: string,
	period: string,
	wave1: Wave1
): Effect.Effect<MemoryWorld> =>
	Effect.gen(function* () {
		const company = wave1.companies[0];
		if (company == null) refuse(`Company ${companyId} does not exist.`);
		const grammar = periodGrammarFault(period, company as { pay_frequency: string; name?: string });
		if (grammar != null) refuse(grammar);
		const window = resolveWindow(period, company as Parameters<typeof resolveWindow>[1]);
		const employmentIds = wave1.employments.map((row) => String(row.id));
		const employeeIds = [...new Set(wave1.employments.map((row) => String(row.employee_id)))];
		const settingsCode = String(company.settings_code ?? '');
		const lineageIds = wave1.jurisdiction_settings
			.filter((row) => row.code === settingsCode)
			.map((row) => String(row.id));
		// The attendance span, one month either side: a deferred joining period reads the previous
		// period's window, and a leaver's tail runs to the exit inside the salary window.
		const months = new Set<string>([
			shiftPeriod(monthKey(window.attendance.start), -1),
			monthKey(window.attendance.start),
			monthKey(window.salary.end)
		]);
		const ordered = [...months].toSorted();
		const spanStart = monthBounds(ordered[0]!).start;
		const spanEnd = monthBounds(ordered.at(-1)!).end;
		const inSpan = (column: string) => ({
			[column]: { gte: dayInstant(spanStart), lt: dayInstant(addDays(spanEnd, 1)) }
		});
		const under = { settings_id: { in: lineageIds }, ...APPROVED } as const;
		const [
			employees,
			employment_terms,
			employment_statutory_facts,
			employment_wage_periods,
			company_facts,
			schemes,
			schemeIndex,
			leave_catalogue,
			claim_catalogue,
			adhoc_catalogue,
			allowance_catalogue,
			loan_catalogue,
			jurisdiction_holidays,
			work_days,
			rosters,
			leave_entries,
			loans,
			loan_repayments,
			payslips
		] = yield* Effect.all(
			[
				db.employees.findMany({
					where: { id: { in: employeeIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.employment_terms.findMany({
					where: { employment_id: { in: employmentIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.employment_statutory_facts.findMany({
					where: { employee_id: { in: employeeIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.company_facts.findMany({
					where: { company_id: { eq: companyId }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.employment_wage_periods.findMany({
					where: { employment_id: { in: employmentIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.statutory_contributions.findMany({ where: under, limit: PAGE_LIMIT }),
				// Every scheme by identity, so a fact naming another lineage still resolves its code.
				db.statutory_contributions.findMany({
					columns: { id: true, code: true, settings_id: true },
					limit: PAGE_LIMIT
				}),
				db.leave_catalogue.findMany({ where: under, limit: PAGE_LIMIT }),
				db.claim_catalogue.findMany({ where: under, limit: PAGE_LIMIT }),
				db.adhoc_catalogue.findMany({ where: under, limit: PAGE_LIMIT }),
				db.allowance_catalogue.findMany({ where: under, limit: PAGE_LIMIT }),
				db.loan_catalogue.findMany({ where: under, limit: PAGE_LIMIT }),
				db.jurisdiction_holidays.findMany({
					where: {
						company_id: { eq: companyId },
						...inSpan('date'),
						published_at: { isNotNull: true },
						...APPROVED
					},
					limit: PAGE_LIMIT
				}),
				db.work_days.findMany({
					where: { employment_id: { in: employmentIds }, ...inSpan('work_date'), ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.rosters.findMany({
					where: { employment_id: { in: employmentIds }, period: { in: ordered }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.leave_entries.findMany({
					where: { employment_id: { in: employmentIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.loans.findMany({
					where: { employment_id: { in: employmentIds }, ...APPROVED },
					limit: PAGE_LIMIT
				}),
				db.loan_repayments.findMany({
					where: { employment_id: { in: employmentIds } },
					limit: PAGE_LIMIT
				}),
				db.payslips.findMany({
					where: { employment_id: { in: employmentIds } },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		const byId = new Map<string, MemoryRow>();
		for (const row of schemeIndex) byId.set(String(row.id), row);
		for (const row of schemes) byId.set(String(row.id), row);
		return {
			companies: wave1.companies,
			jurisdiction_settings: wave1.jurisdiction_settings,
			shift_definitions: wave1.shift_definitions,
			shift_patterns: wave1.shift_patterns,
			employments: wave1.employments,
			payroll_runs: wave1.payroll_runs,
			claim_requests: wave1.claim_requests,
			adhoc_requests: wave1.adhoc_requests,
			employees: complete(employees, 'employees'),
			employment_terms: complete(employment_terms, 'employment terms'),
			employment_statutory_facts: complete(employment_statutory_facts, 'statutory facts'),
			company_facts: complete(company_facts, 'company facts'),
			employment_wage_periods: complete(employment_wage_periods, 'wage periods'),
			statutory_contributions: [...byId.values()],
			leave_catalogue: complete(leave_catalogue, 'leave catalogue'),
			claim_catalogue: complete(claim_catalogue, 'claim catalogue'),
			adhoc_catalogue: complete(adhoc_catalogue, 'ad hoc catalogue'),
			allowance_catalogue: complete(allowance_catalogue, 'allowance catalogue'),
			loan_catalogue: complete(loan_catalogue, 'loan catalogue'),
			jurisdiction_holidays: complete(jurisdiction_holidays, 'published holidays'),
			work_days: complete(work_days, 'work days'),
			rosters: complete(rosters, 'rosters'),
			leave_entries: complete(leave_entries, 'leave entries'),
			loans: complete(loans, 'loans'),
			loan_repayments: complete(loan_repayments, 'loan repayments'),
			payslips: complete(payslips, 'payslips')
		};
	});

/** One run's world, keyed `${companyId}:${period}`, read for every input of the batch at once. */
export const preloadPayrollWorlds = (
	db: PayrollReadApi['db'],
	runs: ReadonlyArray<{ readonly company_id: string; readonly period: string }>
): Effect.Effect<ReadonlyMap<string, MemoryWorld>> =>
	Effect.gen(function* () {
		const firstWave = yield* Effect.all(
			runs.map((run) => readWave1(db, run.company_id)),
			{ concurrency: 'unbounded' }
		);
		const worlds = yield* Effect.all(
			runs.map((run, index) => readWave2(db, run.company_id, run.period, firstWave[index]!)),
			{ concurrency: 'unbounded' }
		);
		return new Map(runs.map((run, index) => [`${run.company_id}:${run.period}`, worlds[index]!]));
	});
