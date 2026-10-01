/**
 * Everything one payroll run reads, in two read waves (§3.3.4, rule 27): wave 1 by the company and period,
 * wave 2 by the people, the window and the lineage the first named. The engine then filters these arrays.
 */

import { refuse } from '../refuse.js';
import { everyField } from '../every-field.js';
import { readAll, type Reads } from '../reads.js';
import type { WorkspaceRow } from '../rows.js';
import type { CollectionName } from '@norbital-ai/bolt';
import { settingsInForce } from '../jurisdiction_settings.js';
import { addDays, monthBounds, monthKey, shiftPeriod } from '../../lib/payroll/run/dates.js';
import { periodGrammarFault, resolveWindow } from '../../lib/payroll/run/period.js';
import { decodeNumber } from '../../lib/wire.js';
import { dateKey } from '../../lib/iso-day.js';
import { coversDate } from './run/effective.js';
import { historyReachDays } from '../expressions/functions/history.js';

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
	| 'presence_periods'
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

/**
 * Everything one run reads, whole, as the engine filters it. `fact_evidence` is read only where the
 * lineage declares evidence on an entity, terms or work-day input; absent is none recorded.
 */
export type PayrollWorld = { readonly [C in PayrollCollection]: readonly WorkspaceRow<C>[] } & {
	readonly fact_evidence?: readonly WorkspaceRow<'fact_evidence'>[];
	/** The company's worksite revisions (`worksite.*`); absent is none recorded. */
	readonly worksites?: readonly WorkspaceRow<'worksites'>[];
	/** The people's dated fact revisions (`employee.facts.*`); absent is none recorded. */
	readonly person_facts?: readonly WorkspaceRow<'person_facts'>[];
	/** The people's history outside this payroll (`history.external`); absent is none recorded. */
	readonly employment_history?: readonly WorkspaceRow<'employment_history'>[];
	/** The lineage versions' table rows (`table()`, `band()`, `bands()`); absent is none. */
	readonly reference_rows?: readonly WorkspaceRow<'reference_rows'>[];
	/** The first day `work_days` covers: `history.days(window)` refuses a window before it. */
	readonly work_days_from?: string;
};

/** The largest page the run reads of one collection; a run that reaches it refuses rather than lie. */
const PAGE_LIMIT = 20_000;

const APPROVED = { approval_id: { isNull: true } } as const;

/**
 * A catalogue row as the run prices it: every field but `authority`, the paragraph of statute
 * carried on each row. One lineage's five catalogues quote about 0.7 MB of it, which put a plant
 * run's single wave-2 crossing over the 4 MiB answer wall. No pricing path reads it — only a
 * scheme charge carries a citation, and that comes from `statutory_contributions`, read whole.
 */
const priced = <C extends CollectionName>(collection: C): object =>
	Object.fromEntries(
		Object.entries(everyField(collection)).filter(([field]) => field !== 'authority')
	);

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
		claim_requests,
		adhoc_requests,
		employment_statutory_facts
	] = await Promise.all([
		readAll<WorkspaceRow<'jurisdiction_settings'>>(
			db,
			'jurisdiction_settings',
			{
				code: { eq: company.settings_code },
				...APPROVED
			},
			32
		),
		readAll<WorkspaceRow<'shift_definitions'>>(db, 'shift_definitions', onCompany),
		readAll<WorkspaceRow<'shift_patterns'>>(db, 'shift_patterns', onCompany),
		readAll<WorkspaceRow<'employments'>>(db, 'employments', onCompany),
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
		presence_periods,
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
		worksites,
		person_facts,
		employment_history,
		reference_rows
	] = await Promise.all([
		readAll<WorkspaceRow<'employees'>>(db, 'employees', { id: { in: employeeIds }, ...APPROVED }),
		readAll<WorkspaceRow<'employment_terms'>>(db, 'employment_terms', people),
		readAll<WorkspaceRow<'employment_wage_periods'>>(db, 'employment_wage_periods', people),
		// Every recorded stay, whatever year: a residence test reads the four basis years before.
		readAll<WorkspaceRow<'presence_periods'>>(db, 'presence_periods', {
			employee_id: { in: employeeIds },
			...APPROVED
		}),
		readAll<WorkspaceRow<'company_facts'>>(db, 'company_facts', {
			company_id: { eq: companyId },
			...APPROVED
		}),
		readAll<WorkspaceRow<'leave_catalogue'>>(
			db,
			'leave_catalogue',
			under,
			undefined,
			priced('leave_catalogue')
		),
		readAll<WorkspaceRow<'claim_catalogue'>>(
			db,
			'claim_catalogue',
			under,
			undefined,
			priced('claim_catalogue')
		),
		readAll<WorkspaceRow<'adhoc_catalogue'>>(
			db,
			'adhoc_catalogue',
			under,
			undefined,
			priced('adhoc_catalogue')
		),
		readAll<WorkspaceRow<'allowance_catalogue'>>(
			db,
			'allowance_catalogue',
			under,
			undefined,
			priced('allowance_catalogue')
		),
		readAll<WorkspaceRow<'loan_catalogue'>>(
			db,
			'loan_catalogue',
			under,
			undefined,
			priced('loan_catalogue')
		),
		// Whole calendar years: a THR ceiling counts the worker's religious holidays across the year
		// (ID Permenaker 6/2016 art.5(2)); the configuration narrows the rest to the window.
		readAll<WorkspaceRow<'jurisdiction_holidays'>>(db, 'jurisdiction_holidays', {
			company_id: { eq: companyId },
			date: {
				gte: `${spanFrom.slice(0, 4)}-01-01`,
				lt: `${decodeNumber(spanTo.slice(0, 4)) + 1}-01-01`
			},
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
		readAll<WorkspaceRow<'worksites'>>(db, 'worksites', {
			company_id: { eq: companyId },
			...APPROVED
		}),
		readAll<WorkspaceRow<'person_facts'>>(db, 'person_facts', {
			employee_id: { in: employeeIds },
			...APPROVED
		}),
		readAll<WorkspaceRow<'employment_history'>>(db, 'employment_history', {
			employee_id: { in: employeeIds },
			...APPROVED
		}),
		// Every version clones its tables whole: JP's 34 versions carry 9,356 rows (4.1 MB, SPECIFIC_MW
		// labels mostly), over one crossing's 4 MiB. The run reads the row's own columns, not its audit
		// stamps; 5,000 rows are 2.4 MB at JP's widest.
		readAll<WorkspaceRow<'reference_rows'>>(db, 'reference_rows', under, 5000, {
			id: true,
			settings_id: true,
			table: true,
			code: true,
			parent_code: true,
			label: true,
			effective_range: true,
			range_from: true,
			range_to: true,
			values: true,
			approval_id: true
		})
	]);
	// The history is its own crossing: its first pages beside the wave's answers put a company's second
	// run over the 4 MiB answer wall (Nihon, 89 slips: 3.4 MB of wave, 1 MB of slips, 0.4 MB of run).
	// ponytail: each payslip page is still a crossing; a slip no longer stores its schemes' statute text
	// (~4 KB a slip), so 200 a page reach a year of a 90-person company in ~6 pages.
	const [payslips, payroll_runs] = await Promise.all([
		readAll<WorkspaceRow<'payslips'>>(db, 'payslips', { employment_id: { in: employmentIds } }),
		// A run row carries every person's trace, which no pricing path reads: the run is read without it,
		// in one crossing whatever the company's size.
		readAll<WorkspaceRow<'payroll_runs'>>(
			db,
			'payroll_runs',
			{ company_id: { eq: companyId } },
			undefined,
			Object.fromEntries(
				Object.entries(everyField('payroll_runs')).filter(
					([field]) => field !== 'calculation_trace'
				)
			)
		)
	]);
	// A piece leaver's history (`results_pay.piece_history_weeks`; TH s.118 reads up to 400 last
	// piece-workdays, so 400 weeks at one workday a week). Sparse work beyond that horizon refuses
	// at the severance expression instead of guessing.
	const pieceHistoryWeeks = governing?.work_rules.wages?.results_pay?.piece_history_weeks ?? 0;
	const pieceIds =
		pieceHistoryWeeks > 0
			? first.employments
					.filter((employment) => {
						// A date period reads as its plain ends: `to` is the open end.
						const exit = dateKey(employment.effective_range?.to);
						return (
							exit !== '' &&
							exit <= window.salary.end &&
							employment_terms.some(
								(term) =>
									term.employment_id === employment.id &&
									term.statutory_work_category === 'PIECE_RATE' &&
									coversDate(term.effective_range, exit)
							)
						);
					})
					.map((employment) => employment.id)
			: [];
	const pieceHistoryFrom = addDays(spanFrom, -pieceHistoryWeeks * 7);
	const evidenced = first.jurisdiction_settings.some(
		(version) =>
			version.code === settingsCode &&
			[
				...(version.facts ?? []),
				...(version.terms_facts ?? []),
				...(version.work_day_facts ?? [])
			].some((field) => field.evidence != null)
	);
	// E4: the version's literal history windows size the earlier work days (`history.days`).
	const reach = historyReachDays(
		[
			governing,
			...statutory_contributions,
			...leave_catalogue,
			...claim_catalogue,
			...adhoc_catalogue,
			...allowance_catalogue
		].map((row) => JSON.stringify(row ?? null))
	);
	const historyFrom = addDays(spanFrom, -reach);
	const [earlierPieceDays, earlierPieceRosters, fact_evidence, earlierDays] = await Promise.all([
		readAll<WorkspaceRow<'work_days'>>(
			db,
			'work_days',
			{
				employment_id: { in: pieceIds },
				work_date: { gte: pieceHistoryFrom, lt: spanFrom },
				...APPROVED
			},
			1000
		),
		readAll<WorkspaceRow<'rosters'>>(db, 'rosters', {
			employment_id: { in: pieceIds },
			period: { gte: monthKey(pieceHistoryFrom), lt: monthKey(spanFrom) },
			...APPROVED
		}),
		evidenced
			? readAll<WorkspaceRow<'fact_evidence'>>(db, 'fact_evidence', {
					or: [
						{ subject: { employment_terms: { in: employment_terms.map((row) => row.id) } } },
						{ subject: { work_days: { in: work_days.map((row) => row.id) } } },
						{ subject: { company_facts: { in: company_facts.map((row) => row.id) } } }
					],
					...APPROVED
				})
			: [],
		reach > 0
			? readAll<WorkspaceRow<'work_days'>>(
					db,
					'work_days',
					{ ...people, work_date: { gte: historyFrom, lt: spanFrom } },
					1000
				)
			: []
	]);
	const pieceIdSet = new Set(earlierPieceDays.map((row) => row.id));
	const earlier = [...earlierPieceDays, ...earlierDays.filter((row) => !pieceIdSet.has(row.id))];
	const work_days_from = [
		reach > 0 ? historyFrom : spanFrom,
		...(pieceIds.length > 0 ? [pieceHistoryFrom] : [])
	].toSorted()[0]!;
	return {
		...first,
		payroll_runs: complete(payroll_runs, 'payroll runs'),
		jurisdiction_settings: [...first.jurisdiction_settings, ...foreignSettings],
		employees: complete(employees, 'employees'),
		employment_terms: complete(employment_terms, 'employment terms'),
		company_facts: complete(company_facts, 'company facts'),
		employment_wage_periods: complete(employment_wage_periods, 'wage periods'),
		presence_periods: complete(presence_periods, 'stays'),
		statutory_contributions: complete(statutory_contributions, 'statutory schemes'),
		leave_catalogue: complete(leave_catalogue, 'leave catalogue'),
		claim_catalogue: complete(claim_catalogue, 'claim catalogue'),
		adhoc_catalogue: complete(adhoc_catalogue, 'ad hoc catalogue'),
		allowance_catalogue: complete(allowance_catalogue, 'allowance catalogue'),
		loan_catalogue: complete(loan_catalogue, 'loan catalogue'),
		jurisdiction_holidays: complete(jurisdiction_holidays, 'published holidays'),
		work_days: complete([...earlier, ...work_days], 'work days'),
		work_days_from,
		rosters: complete([...earlierPieceRosters, ...rosters], 'rosters'),
		leave_entries: complete(leave_entries, 'leave entries'),
		loans: complete(loans, 'loans'),
		loan_repayments: complete(loan_repayments, 'loan repayments'),
		payslips: complete(payslips, 'payslips'),
		fact_evidence: complete(fact_evidence, 'fact evidence'),
		worksites: complete(worksites, 'worksites'),
		person_facts: complete(person_facts, 'person facts'),
		employment_history: complete(employment_history, 'employment history'),
		reference_rows: complete(reference_rows, 'reference rows')
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
