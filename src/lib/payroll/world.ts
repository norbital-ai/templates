/**
 * Everything one payroll run reads, in two read waves (§3.3.4, rule 27): wave 1 by the company and period,
 * wave 2 by the people, the window and the lineage the first named. The engine then filters these arrays.
 */

import { refuse } from '../refuse.js';
import { readAll, type Reads } from '../reads.js';
import type { WorkspaceRow } from '../rows.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { addDays, monthBounds, monthKey, shiftPeriod } from '../../lib/payroll/run/dates.js';
import { periodGrammarFault, resolveWindow } from '../../lib/payroll/run/period.js';

type PayrollCollection =
	| 'companies'
	| 'company_facts'
	| 'jurisdiction_settings'
	| 'statutory_contributions'
	| 'leave_catalogue'
	| 'claim_catalogue'
	| 'adhoc_catalogue'
	| 'allowance_catalogue'
	| 'loan_catalogue'
	| 'shift_definitions'
	| 'shift_patterns'
	| 'jurisdiction_holidays'
	| 'employments'
	| 'employees'
	| 'employment_terms'
	| 'employment_wage_periods'
	| 'employment_statutory_facts'
	| 'claim_requests'
	| 'adhoc_requests'
	| 'leave_entries'
	| 'loans'
	| 'loan_repayments'
	| 'work_days'
	| 'rosters'
	| 'payroll_runs'
	| 'payslips';

/** Everything one run reads, whole, as the engine filters it. */
export type PayrollWorld = { readonly [C in PayrollCollection]: readonly WorkspaceRow<C>[] };

/** The largest page the run reads of one collection; a run that reaches it refuses rather than lie. */
const PAGE_LIMIT = 20_000;

const APPROVED = { approval_id: { isNull: true } } as const;

const complete = <T>(rows: T[], what: string): T[] => {
	if (rows.length >= PAGE_LIMIT)
		refuse(
			`Payroll reached its ${PAGE_LIMIT.toLocaleString('en')}-row ceiling loading ${what}. ` +
				'The complete input must be loaded before this payroll can be calculated.'
		);
	return rows;
};

/** Wave 1: what the company and the period alone can name. */
async function wave1(db: Reads, companyId: string) {
	const onCompany = { company_id: { eq: companyId }, ...APPROVED } as const;
	const companies = complete(
		await readAll<WorkspaceRow<'companies'>>(db, 'companies', {
			id: { eq: companyId },
			...APPROVED
		}),
		'companies'
	);
	const company = companies[0];
	if (company == null) refuse(`Company ${companyId} does not exist.`);
	const [
		jurisdiction_settings,
		shift_definitions,
		shift_patterns,
		employments,
		payroll_runs,
		claim_requests,
		adhoc_requests,
		employment_statutory_facts
	] = await Promise.all([
		readAll<WorkspaceRow<'jurisdiction_settings'>>(db, 'jurisdiction_settings', {
			code: { eq: company.settings_code },
			...APPROVED
		}),
		readAll<WorkspaceRow<'shift_definitions'>>(db, 'shift_definitions', onCompany),
		readAll<WorkspaceRow<'shift_patterns'>>(db, 'shift_patterns', onCompany),
		readAll<WorkspaceRow<'employments'>>(db, 'employments', onCompany),
		readAll<WorkspaceRow<'payroll_runs'>>(db, 'payroll_runs', { company_id: { eq: companyId } }),
		// The money families reach the people through the employment relation, so their consumption history
		// (a pinned claim or ad hoc request) is in hand by wave 2.
		readAll<WorkspaceRow<'claim_requests'>>(db, 'claim_requests', {
			employment_id: { is: { company_id: { eq: companyId } } }
		}),
		readAll<WorkspaceRow<'adhoc_requests'>>(db, 'adhoc_requests', {
			employment_id: { is: { company_id: { eq: companyId } } }
		}),
		// Every registration of the people employed here, so wave 2 can read exactly the schemes they name.
		readAll<WorkspaceRow<'employment_statutory_facts'>>(db, 'employment_statutory_facts', {
			employee_id: { is: { employments: { some: { company_id: { eq: companyId } } } } },
			...APPROVED
		})
	]);
	return {
		companies,
		jurisdiction_settings: complete(jurisdiction_settings, 'jurisdiction settings'),
		shift_definitions: complete(shift_definitions, 'shift definitions'),
		shift_patterns: complete(shift_patterns, 'shift patterns'),
		employments: complete(employments, 'employments'),
		payroll_runs: complete(payroll_runs, 'payroll runs'),
		claim_requests: complete(claim_requests, 'claim requests'),
		adhoc_requests: complete(adhoc_requests, 'ad hoc requests'),
		employment_statutory_facts: complete(employment_statutory_facts, 'statutory facts')
	};
}

type Wave1 = Awaited<ReturnType<typeof wave1>>;

/** Wave 2: what the people, the window and the lineage of wave 1 name. */
async function wave2(
	db: Reads,
	companyId: string,
	period: string,
	first: Wave1
): Promise<PayrollWorld> {
	const company = first.companies[0];
	if (company == null) refuse(`Company ${companyId} does not exist.`);
	const grammar = periodGrammarFault(period, company);
	if (grammar != null) refuse(grammar);
	const window = resolveWindow(period, company);
	const employmentIds = first.employments.map((row) => String(row.id));
	const employeeIds = [...new Set(first.employments.map((row) => String(row.employee_id)))];
	const settingsCode = company.settings_code ?? '';
	const lineageIds = first.jurisdiction_settings
		.filter((row) => row.code === settingsCode)
		.map((row) => String(row.id));
	const schemeIds = [
		...new Set(first.employment_statutory_facts.map((row) => String(row.statutory_contribution_id)))
	];
	// The attendance span, one month either side: a deferred joining period reads the previous period's
	// window, and a leaver's tail runs to the exit inside the salary window.
	const months = [
		...new Set([
			shiftPeriod(monthKey(window.attendance.start), -1),
			monthKey(window.attendance.start),
			monthKey(window.salary.end)
		])
	].toSorted();
	const spanFrom = monthBounds(months[0]!).start;
	const spanTo = addDays(monthBounds(months.at(-1)!).end, 1);
	const people = { employment_id: { in: employmentIds }, ...APPROVED } as const;
	const under = { settings_id: { in: lineageIds }, ...APPROVED } as const;
	// The governing version's schemes whole, read alone before the wave: a Malaysian version's tables are
	// megabytes (the EPF schedule alone 0.7 MB), so they page at 4 rows a crossing. Every other scheme of the
	// lineage, and every scheme a registration names, is read once without its rules: realignment reads its
	// code and version, Leave its elections.
	const governing = settingsInForce(
		first.jurisdiction_settings.filter((row) => row.code === settingsCode),
		settingsCode,
		window.salary.end
	);
	const [whole, thin] = await Promise.all([
		readAll<WorkspaceRow<'statutory_contributions'>>(
			db,
			'statutory_contributions',
			{ settings_id: { in: governing == null ? [] : [governing.id] }, ...APPROVED },
			4
		),
		readAll<WorkspaceRow<'statutory_contributions'>>(
			db,
			'statutory_contributions',
			{ or: [under, { id: { in: schemeIds } }] },
			undefined,
			{ id: true, code: true, settings_id: true, elections: true, approval_id: true }
		)
	]);
	const wholeIds = new Set(whole.map((row) => row.id));
	const statutory_contributions = [...whole, ...thin.filter((row) => !wholeIds.has(row.id))];
	const foreignSettingsIds = [
		...new Set(thin.map((row) => row.settings_id).filter((id) => !lineageIds.includes(id)))
	];
	const foreignSettings = await readAll<WorkspaceRow<'jurisdiction_settings'>>(
		db,
		'jurisdiction_settings',
		{ id: { in: foreignSettingsIds }, ...APPROVED },
		undefined,
		{ id: true, code: true, jurisdiction_code: true }
	);
	const [
		employees,
		employment_terms,
		employment_wage_periods,
		company_facts,
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
	] = await Promise.all([
		readAll<WorkspaceRow<'employees'>>(db, 'employees', { id: { in: employeeIds }, ...APPROVED }),
		readAll<WorkspaceRow<'employment_terms'>>(db, 'employment_terms', people),
		readAll<WorkspaceRow<'employment_wage_periods'>>(db, 'employment_wage_periods', people),
		readAll<WorkspaceRow<'company_facts'>>(db, 'company_facts', {
			company_id: { eq: companyId },
			...APPROVED
		}),
		readAll<WorkspaceRow<'leave_catalogue'>>(db, 'leave_catalogue', under),
		readAll<WorkspaceRow<'claim_catalogue'>>(db, 'claim_catalogue', under),
		readAll<WorkspaceRow<'adhoc_catalogue'>>(db, 'adhoc_catalogue', under),
		readAll<WorkspaceRow<'allowance_catalogue'>>(db, 'allowance_catalogue', under),
		readAll<WorkspaceRow<'loan_catalogue'>>(db, 'loan_catalogue', under),
		readAll<WorkspaceRow<'jurisdiction_holidays'>>(db, 'jurisdiction_holidays', {
			company_id: { eq: companyId },
			date: { gte: spanFrom, lt: spanTo },
			published_at: { isNull: false },
			...APPROVED
		}),
		readAll<WorkspaceRow<'work_days'>>(
			db,
			'work_days',
			{
				...people,
				work_date: { gte: spanFrom, lt: spanTo }
			},
			1000
		),
		readAll<WorkspaceRow<'rosters'>>(db, 'rosters', { ...people, period: { in: months } }),
		readAll<WorkspaceRow<'leave_entries'>>(db, 'leave_entries', people),
		readAll<WorkspaceRow<'loans'>>(db, 'loans', people),
		readAll<WorkspaceRow<'loan_repayments'>>(db, 'loan_repayments', {
			employment_id: { in: employmentIds }
		}),
		readAll<WorkspaceRow<'payslips'>>(db, 'payslips', { employment_id: { in: employmentIds } })
	]);
	return {
		...first,
		jurisdiction_settings: [...first.jurisdiction_settings, ...foreignSettings],
		employees: complete(employees, 'employees'),
		employment_terms: complete(employment_terms, 'employment terms'),
		company_facts: complete(company_facts, 'company facts'),
		employment_wage_periods: complete(employment_wage_periods, 'wage periods'),
		statutory_contributions: complete(statutory_contributions, 'statutory schemes'),
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
}

/** One run's world, keyed `${companyId}:${period}`, read for every input of the batch at once. */
export async function readPayrollWorlds(
	db: Reads,
	runs: ReadonlyArray<{ readonly company_id: string; readonly period: string }>
): Promise<ReadonlyMap<string, PayrollWorld>> {
	const firsts = await Promise.all(runs.map((run) => wave1(db, run.company_id)));
	const worlds = await Promise.all(
		runs.map((run, index) => wave2(db, run.company_id, run.period, firsts[index]!))
	);
	return new Map(runs.map((run, index) => [`${run.company_id}:${run.period}`, worlds[index]!]));
}
