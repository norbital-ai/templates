import { childrenOn, resolveEmployment, type ResolvedEmployment } from '../employment-contract.js';
import { Effect } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_entries/$types.js';
import type { LeaveWindow } from './entitlement.js';
import { withPendingLeaveEntries, type LeaveActivity } from './pending.js';
import { normaliseLeaveDays } from './activity-fields.js';
import { computedEntitlement } from './entitlement.js';
import { dateKey, dayInstant } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import type { CompanyFactRevision } from '../declared-facts.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { addDays } from '../../collections/payroll_runs/lib/dates.js';
import { rosterCodeKind } from '../scheduling/roster-code.js';
import { resolveCompanyFacts } from '../declared-facts.js';
import { personFactsOn } from '../payroll/facts.js';
import {
	isEligible,
	personContext,
	type PersonContext,
	type PersonInput
} from '../../collections/payroll_runs/lib/eligibility.js';

type ReadTables =
	| 'employments'
	| 'employees'
	| 'companies'
	| 'company_facts'
	| 'jurisdiction_settings'
	| 'statutory_contributions'
	| 'leave_catalogue'
	| 'employment_terms'
	| 'work_days'
	| 'shift_patterns'
	| 'shift_definitions'
	| 'jurisdiction_holidays'
	| 'payroll_runs'
	| 'payslips'
	| 'employment_statutory_facts';
export type LeaveReadApi = {
	db: { [K in ReadTables | 'leave_entries']: Pick<Api<WorkspaceSchema>['db'][K], 'findMany'> };
};
const LIMIT = 20_000;
function complete<T>(rows: readonly T[], name: string): readonly T[] {
	if (rows.length >= LIMIT)
		refuse(`The ${name} read reached its safety ceiling; leave cannot be verified.`);
	return rows;
}

export type LeaveContext = {
	employments: (Pick<
		ResolvedEmployment,
		'id' | 'employee_id' | 'company_id' | 'effective_range'
	> & {
		readonly exit_reason?: string | null;
		readonly exit_facts?: Readonly<Record<string, string | number | boolean>> | null;
	})[];
	companies: (Pick<
		WorkspaceRow<'companies'>,
		'id' | 'settings_code' | 'region' | 'pay_frequency'
	> & {
		readonly facts?: WorkspaceRow<'companies'>['facts'] | null;
		/** Dated entity fact revisions, so a leave rule reads the facts of its own date. */
		readonly fact_revisions?: readonly CompanyFactRevision[];
	})[];
	employees: Pick<
		WorkspaceRow<'employees'>,
		| 'id'
		| 'gender'
		| 'date_of_birth'
		| 'nationality'
		| 'marital_status'
		| 'solo_parent'
		| 'disabled'
		| 'race'
		| 'religion'
		| 'children'
	>[];
	terms: Pick<
		WorkspaceRow<'employment_terms'>,
		| 'id'
		| 'employment_id'
		| 'effective_range'
		| 'shift_pattern_id'
		| 'employment_type'
		| 'residency_status'
		| 'work_classification'
		| 'base_salary'
		| 'statutory_work_category'
		| 'department'
		| 'payroll_group'
		| 'grade'
		| 'residency_since'
		| 'pay_frequency'
		| 'pass_type'
		| 'tax_residency'
		| 'notice_days'
	>[];
	/** The lineage's scheme codes, so `facts.<CODE>` reads false rather than failing for an unregistered one. */
	schemeCodes?: string[];
	schemes?: Array<{
		id: string;
		code: string;
		elections: WorkspaceRow<'statutory_contributions'>['elections'];
	}>;
	/** Statutory facts by employee, with the scheme's code resolved: what `person.facts.<CODE>` reads; absent is none. */
	facts?: {
		employee_id: string;
		employment_id: string | null;
		statutory_contribution_id: string;
		code: string;
		effective_range: WorkspaceRow<'employment_statutory_facts'>['effective_range'];
		status: WorkspaceRow<'employment_statutory_facts'>['status'];
	}[];
	entries: LeaveActivity[];
	/**
	 * The time off of the same people under their other employments here (a rehire's earlier
	 * contract), for the lifetime counts and caps; absent is none. Keyed to the person through
	 * `employee_id`, never read as this employment's own.
	 */
	priorEntries?: (Pick<
		LeaveActivity,
		| 'id'
		| 'employment_id'
		| 'leave_code'
		| 'charges'
		| 'as_adjustment_entry'
		| 'reversal_of_id'
		| 'approval_id'
	> & {
		readonly employee_id: string;
	})[];
	versions: Pick<
		WorkspaceRow<'jurisdiction_settings'>,
		| 'id'
		| 'code'
		| 'payroll'
		| 'jurisdiction_code'
		| 'sealed_at'
		| 'voided_at'
		| 'effective_range'
		| 'approval_id'
		| 'facts'
		| 'exit_facts'
	>[];
	catalogues: Pick<
		WorkspaceRow<'leave_catalogue'>,
		| 'id'
		| 'settings_id'
		| 'code'
		| 'name'
		| 'eligibility'
		| 'entitlement'
		| 'evidence_after_days'
		| 'is_npl'
		| 'can_encash'
		| 'encash_on_exit'
		| 'pay_fraction'
		| 'paid_by'
		| 'consumes_code'
		| 'unit'
	>[];
	holidays: Pick<
		WorkspaceRow<'jurisdiction_holidays'>,
		'id' | 'company_id' | 'date' | 'name' | 'kind' | 'replaces' | 'given_to' | 'published_at'
	>[];
	workDays: Pick<
		WorkspaceRow<'work_days'>,
		'id' | 'employment_id' | 'work_date' | 'shift_definition_id'
	>[];
	/**
	 * Rostered days read and found empty — absent without leave — by employment and day, over
	 * the twelve months before the window; what `employment.absent_days_12m` counts. Absent is
	 * none counted.
	 */
	absences?: { employment_id: string; work_date: string }[];
	runs: Pick<
		WorkspaceRow<'payroll_runs'>,
		'id' | 'company_id' | 'period' | 'attendance_from' | 'attendance_to'
	>[];
	patterns: Pick<WorkspaceRow<'shift_patterns'>, 'id' | 'code' | 'pattern' | 'effective_range'>[];
	shifts: Pick<
		WorkspaceRow<'shift_definitions'>,
		'id' | 'company_id' | 'variant' | 'effective_range'
	>[];
	payslips: Pick<
		WorkspaceRow<'payslips'>,
		'id' | 'payroll_run_id' | 'employment_id' | 'currency' | 'paid_at' | 'adjustments'
	>[];
};

/**
 * One batched, guarded read of employment history and manual activity, in two waves. No balance
 * rows or writes.
 *
 * Wave 1 is keyed by the employment ids alone: the employments with their person and entity
 * nested, their terms, every leave entry (held proposals included), the window's work days and
 * every settings version. Wave 2 is keyed by what wave 1 named — the lineage's catalogues, the
 * entities' runs, roster vocabulary and holidays, and the payslips that settled a reversed entry.
 */
export function readLeaveContext(
	api: LeaveReadApi,
	employmentIds: readonly string[],
	window?: LeaveWindow,
	includeSettlements = false
): Effect.Effect<LeaveContext> {
	return Effect.gen(function* () {
		const ids = [...new Set(employmentIds)];
		const [employmentRows, terms, allEntries, workDays, versions] = yield* Effect.all(
			[
				api.db.employments.findMany({
					where: { id: { in: ids }, approval_id: { isNull: true } },
					columns: {
						id: true,
						employee_id: true,
						company_id: true,
						effective_range: true,
						exit_reason: true,
						exit_facts: true
					},
					with: {
						employment_employee: {
							columns: {
								id: true,
								gender: true,
								date_of_birth: true,
								nationality: true,
								marital_status: true,
								solo_parent: true,
								disabled: true,
								race: true,
								religion: true,
								children: true
							}
						},
						employment_company: {
							columns: {
								id: true,
								settings_code: true,
								region: true,
								pay_frequency: true,
								facts: true
							},
							with: {
								// The entity's dated facts in the same wave; a leave rule reads the revision
								// in force on its own date.
								company_fact_company: {
									where: { approval_id: { isNull: true } },
									columns: { facts: true, effective_range: true },
									limit: LIMIT
								}
							}
						}
					},
					limit: LIMIT
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { in: ids }, approval_id: { isNull: true } },
					columns: {
						id: true,
						employment_id: true,
						effective_range: true,
						shift_pattern_id: true,
						employment_type: true,
						residency_status: true,
						work_classification: true,
						base_salary: true,
						statutory_work_category: true,
						department: true,
						payroll_group: true,
						grade: true,
						residency_since: true,
						pay_frequency: true,
						pass_type: true,
						tax_residency: true,
						notice_days: true
					},
					limit: LIMIT
				}),
				api.db.leave_entries.findMany({
					where: { employment_id: { in: ids } },
					columns: {
						id: true,
						employment_id: true,
						catalogue_id: true,
						leave_code: true,
						reference: true,
						from_date: true,
						to_date: true,
						half_day_start: true,
						half_day_end: true,
						days: true,
						encash_days: true,
						as_adjustment_entry: true,
						reversal_of_id: true,
						effective_on: true,
						due_on: true,
						destination_from: true,
						destination_to: true,
						available_from: true,
						expires_on: true,
						reason: true,
						charges: true,
						allocations: true,
						approval_id: true,
						payslip_id: true,
						event_kind: true,
						event_relationship: true,
						event_date: true
					},
					limit: LIMIT
				}),
				api.db.work_days.findMany({
					where: {
						employment_id: { in: window == null ? [] : ids },
						...(window == null
							? {}
							: { work_date: { gte: dayInstant(window.start), lte: dayInstant(window.end) } }),
						approval_id: { isNull: true }
					},
					columns: { id: true, employment_id: true, work_date: true, shift_definition_id: true },
					limit: LIMIT
				}),
				api.db.jurisdiction_settings.findMany({
					where: { approval_id: { isNull: true } },
					columns: {
						id: true,
						code: true,
						jurisdiction_code: true,
						sealed_at: true,
						payroll: true,
						voided_at: true,
						effective_range: true,
						approval_id: true,
						facts: true,
						exit_facts: true
					},
					limit: LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		for (const [rows, name] of [
			[employmentRows, 'employments'],
			[terms, 'terms'],
			[allEntries, 'leave entries'],
			[workDays, 'workdays'],
			[versions, 'settings versions']
		] as const)
			complete<unknown>(rows, name);
		const employments = employmentRows.map((row) => ({
			...resolveEmployment({
				id: row.id,
				employee_id: row.employee_id,
				company_id: row.company_id,
				effective_range: row.effective_range
			}),
			exit_reason: row.exit_reason,
			exit_facts: row.exit_facts
		}));
		const companies = [
			...new Map(
				employmentRows.flatMap((row) =>
					row.employment_company == null
						? []
						: [[row.employment_company.id, row.employment_company] as const]
				)
			).values()
		];
		const employees = [
			...new Map(
				employmentRows.flatMap((row) =>
					row.employment_employee == null
						? []
						: [[row.employment_employee.id, row.employment_employee] as const]
				)
			).values()
		];
		const companyIds = [...new Set(employments.map((row) => row.company_id))];
		const companiesWithRevisions = companies.map((row) => ({
			...row,
			fact_revisions: row.company_fact_company ?? []
		}));
		const settingsCodes = new Set(companies.map((row) => row.settings_code));
		const lineage = versions.filter((row) => settingsCodes.has(row.code));
		const stored = allEntries.filter((row) => row.approval_id == null).map(normaliseLeaveDays);
		// A settled entry names its payslip directly. The payslip's stored adjustments are the
		// frozen evidence a reversal negates.
		const settlingIds = [
			...new Set(stored.flatMap((row) => (row.payslip_id == null ? [] : [row.payslip_id])))
		];
		const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
		const [
			catalogues,
			runs,
			patterns,
			shifts,
			holidays,
			payslips,
			siblings,
			schemes,
			factRows,
			emptyDays
		] = yield* Effect.all(
			[
				api.db.leave_catalogue.findMany({
					where: {
						settings_id: { in: lineage.map((row) => row.id) },
						approval_id: { isNull: true }
					},
					columns: {
						id: true,
						settings_id: true,
						code: true,
						name: true,
						eligibility: true,
						entitlement: true,
						evidence_after_days: true,
						is_npl: true,
						can_encash: true,
						encash_on_exit: true,
						pay_fraction: true,
						paid_by: true,
						consumes_code: true,
						unit: true
					},
					limit: LIMIT
				}),
				api.db.payroll_runs.findMany({
					where: { company_id: { in: companyIds }, approval_id: { isNull: true } },
					columns: {
						id: true,
						company_id: true,
						period: true,
						attendance_from: true,
						attendance_to: true
					},
					limit: LIMIT
				}),
				// The roster vocabulary belongs to the entity, which the employment read names.
				window == null || settingsCodes.size === 0
					? Effect.succeed([])
					: api.db.shift_patterns.findMany({
							where: { company_id: { in: companyIds }, approval_id: { isNull: true } },
							columns: { id: true, code: true, pattern: true, effective_range: true },
							limit: LIMIT
						}),
				window == null || settingsCodes.size === 0
					? Effect.succeed([])
					: api.db.shift_definitions.findMany({
							where: { company_id: { in: companyIds }, approval_id: { isNull: true } },
							columns: { id: true, company_id: true, variant: true, effective_range: true },
							limit: LIMIT
						}),
				api.db.jurisdiction_holidays.findMany({
					where: {
						// The entities of the employments in scope, not their jurisdictions: a holiday
						// belongs to the employer that observes it.
						company_id: { in: window == null ? [] : companyIds },
						...(window == null
							? {}
							: { date: { gte: dayInstant(window.start), lte: dayInstant(window.end) } }),
						published_at: { isNotNull: true },
						approval_id: { isNull: true }
					},
					columns: {
						id: true,
						company_id: true,
						date: true,
						name: true,
						kind: true,
						replaces: true,
						given_to: true,
						published_at: true
					},
					limit: LIMIT
				}),
				!includeSettlements || settlingIds.length === 0
					? Effect.succeed([])
					: api.db.payslips.findMany({
							where: { id: { in: settlingIds }, approval_id: { isNull: true } },
							columns: {
								id: true,
								payroll_run_id: true,
								employment_id: true,
								currency: true,
								paid_at: true,
								adjustments: true
							},
							limit: LIMIT
						}),
				// The people's other employments here, for what a lifetime counts (MY s.60FA(2):
				// five confinements; SG GPCL: 42 days a child) across a rehire.
				api.db.employments.findMany({
					where: { employee_id: { in: employeeIds }, approval_id: { isNull: true } },
					columns: { id: true, employee_id: true },
					limit: LIMIT
				}),
				// The lineage's schemes name the codes a rule reads a fact under (`facts.SI.since_months`).
				api.db.statutory_contributions.findMany({
					where: {
						settings_id: { in: lineage.map((row) => row.id) },
						approval_id: { isNull: true }
					},
					columns: { id: true, code: true, elections: true },
					limit: LIMIT
				}),
				api.db.employment_statutory_facts.findMany({
					where: { employee_id: { in: employeeIds }, approval_id: { isNull: true } },
					columns: {
						employee_id: true,
						employment_id: true,
						statutory_contribution_id: true,
						effective_range: true,
						status: true
					},
					limit: LIMIT
				}),
				// The year before the window: days read and found empty, for a forfeiture rule
				// that counts unauthorised absence (MY s.60E(1)(b)).
				window == null
					? Effect.succeed([])
					: api.db.work_days.findMany({
							where: {
								employment_id: { in: ids },
								work_date: {
									gte: dayInstant(addDays(window.end, -366)),
									lte: dayInstant(window.end)
								},
								worked_intervals: { eq: [] },
								approval_id: { isNull: true }
							},
							columns: { employment_id: true, work_date: true, shift_definition_id: true },
							limit: LIMIT
						})
			],
			{ concurrency: 'unbounded' }
		);
		const workCodeIds = new Set(
			shifts.filter((row) => rosterCodeKind(row.variant) === 'WORK').map((row) => row.id)
		);
		const absences = emptyDays.flatMap((row) =>
			row.shift_definition_id != null && workCodeIds.has(row.shift_definition_id)
				? [{ employment_id: row.employment_id, work_date: dateKey(row.work_date) }]
				: []
		);
		const codeOfScheme = new Map(schemes.map((row) => [row.id, row.code]));
		const facts = factRows.flatMap((row) => {
			const code = codeOfScheme.get(row.statutory_contribution_id);
			return code == null
				? []
				: [
						{
							employee_id: row.employee_id,
							employment_id: row.employment_id,
							statutory_contribution_id: row.statutory_contribution_id,
							code,
							effective_range: row.effective_range,
							status: row.status
						}
					];
		});
		for (const [rows, name] of [
			[catalogues, 'leave catalogues'],
			[runs, 'payroll runs'],
			[patterns, 'shift patterns'],
			[shifts, 'shift definitions'],
			[holidays, 'holidays'],
			[payslips, 'settling payslips']
		] as const)
			complete<unknown>(rows, name);
		const entries = withPendingLeaveEntries(
			allEntries.filter((row) => row.approval_id != null).map(normaliseLeaveDays),
			stored
		);
		const inScope = new Set(ids);
		const others = siblings.filter(
			(row) => !inScope.has(row.id) && employeeIds.includes(row.employee_id)
		);
		const employeeOf = new Map(others.map((row) => [row.id, row.employee_id]));
		const priorEntries =
			others.length === 0
				? []
				: (yield* api.db.leave_entries.findMany({
						where: {
							employment_id: { in: others.map((row) => row.id) },
							approval_id: { isNull: true }
						},
						columns: {
							id: true,
							employment_id: true,
							leave_code: true,
							charges: true,
							as_adjustment_entry: true,
							reversal_of_id: true,
							approval_id: true
						},
						limit: LIMIT
					})).map((row) => ({ ...row, employee_id: employeeOf.get(row.employment_id) ?? '' }));
		return {
			employments,
			priorEntries,
			companies: companiesWithRevisions,
			employees,
			terms,
			schemeCodes: [...new Set(codeOfScheme.values())],
			schemes,
			facts,
			absences,
			entries,
			versions: lineage,
			catalogues,
			holidays,
			workDays,
			runs,
			patterns,
			shifts,
			payslips
		};
	});
}

/** Per-context caches shared by every leave type of an employment (see `personOn`). */
const peopleByContext = new WeakMap<
	LeaveContext,
	Map<string, Map<string, { readonly person: PersonContext; readonly key: string }>>
>();
const personCache = (context: LeaveContext, factsKey: string) => {
	const byEmployment =
		peopleByContext.get(context) ??
		(() => {
			const fresh = new Map<
				string,
				Map<string, { readonly person: PersonContext; readonly key: string }>
			>();
			peopleByContext.set(context, fresh);
			return fresh;
		})();
	const cache = byEmployment.get(factsKey) ?? new Map();
	byEmployment.set(factsKey, cache);
	return cache;
};
const verdictsByContext = new WeakMap<LeaveContext, Map<string, boolean>>();
const eligibilityCache = (context: LeaveContext) => {
	const cache = verdictsByContext.get(context) ?? new Map<string, boolean>();
	verdictsByContext.set(context, cache);
	return cache;
};

/**
 * The pools a leave row draws from: always its own, and — where it `consumes` another row —
 * that row's too, so a day of it counts inside both (an outpatient day inside the 60 days of
 * hospitalisation leave, SG s.89; family care inside personal leave, TW 性平法 §20). The pool's
 * entries are its own row's and every row's that draws from it, so the pool row's balance shows
 * what its consumers took.
 */
export function leavePool(
	context: LeaveContext,
	employmentId: string,
	rules: ReturnType<typeof leaveRules>,
	entries: readonly LeaveActivity[] = context.entries
) {
	const own = entries.filter(
		(row) => row.employment_id === employmentId && row.leave_code === rules.selected.code
	);
	const consumers = (code: string): ReadonlySet<string> =>
		new Set(context.catalogues.filter((row) => row.consumes_code === code).map((row) => row.code));
	const drawing = consumers(rules.selected.code);
	const poolCode = rules.selected.consumes_code;
	const poolRules =
		poolCode == null
			? null
			: leaveRules(
					context,
					employmentId,
					(
						context.catalogues.find(
							(row) => row.code === poolCode && row.settings_id === rules.selected.settings_id
						) ??
						refuse(
							`${rules.selected.code} draws from ${poolCode}, which this version has no row for.`
						)
					).id
				);
	return {
		own,
		/** This row as a pool: its own entries and its consumers' (their pool allocations). */
		asPool: entries.filter(
			(row) =>
				row.employment_id === employmentId &&
				(row.leave_code === rules.selected.code || drawing.has(row.leave_code))
		),
		pool:
			poolRules == null || poolCode == null
				? null
				: {
						code: poolCode,
						rules: poolRules,
						entries: entries.filter(
							(row) =>
								row.employment_id === employmentId &&
								(row.leave_code === poolCode || consumers(poolCode).has(row.leave_code))
						)
					}
	};
}

/** The person of one employment on one date, as every leave rule reads them; uncached. */
export function personAt(
	context: LeaveContext,
	employmentId: string,
	date: string,
	event?: PersonInput['event']
): PersonContext {
	const employment = context.employments.find((row) => row.id === employmentId);
	if (!employment) refuse('Leave requires an approved employment.');
	const company = context.companies.find((row) => row.id === employment.company_id);
	if (!company) refuse('The employing company is not available.');
	const employee = context.employees.find((row) => row.id === employment.employee_id);
	if (!employee) refuse('The employee is not available.');
	const terms = context.terms.filter((row) => row.employment_id === employmentId);
	const range = employment.effective_range;
	const yearBefore = addDays(date, -365);
	return personContext({
		event,
		employee,
		employment: {
			service_start: range == null ? '' : dateKey(range.start),
			exit_date: range?.end == null ? null : dateKey(range.end),
			exit_reason: employment.exit_reason ?? null,
			exit_facts: employment.exit_facts ?? {},
			absent_days_12m: (context.absences ?? []).filter(
				(row) =>
					row.employment_id === employmentId && row.work_date > yearBefore && row.work_date <= date
			).length
		},
		terms: terms.find((row) => coversDate(row.effective_range, date)) ?? null,
		children: childrenOn(employee.children ?? [], date),
		company: {
			...company,
			facts: resolveCompanyFacts(
				settingsInForce(context.versions, company.settings_code, date)?.facts ?? [],
				company,
				{ asOf: date, revisions: company.fact_revisions ?? [] }
			)
		},
		facts:
			context.schemes == null
				? [
						// Every scheme of the lineage reads as unregistered until a fact says otherwise.
						...(context.schemeCodes ?? []).map((code) => ({
							code,
							registered: false,
							since: null
						})),
						...(context.facts ?? [])
							.filter(
								(fact) => fact.employee_id === employee.id && coversDate(fact.effective_range, date)
							)
							.map((fact) => ({
								code: fact.code,
								registered: fact.status?.kind === 'REGISTERED',
								since: fact.status?.kind === 'REGISTERED' ? (fact.status.since ?? null) : null
							}))
					]
				: personFactsOn(
						(context.facts ?? []).filter((fact) => fact.employee_id === employee.id),
						context.schemes,
						date,
						employmentId
					),
		asOf: date
	});
}

/**
 * Resolve a stable leave code against the sealed catalogue and person facts effective on each
 * date. `event` is the entry's event where the rules are read for one per-event entry: the row's
 * eligibility and bands then see it on every date.
 */
export function leaveRules(
	context: LeaveContext,
	employmentId: string,
	catalogueId: string,
	event?: PersonInput['event']
) {
	const employment = context.employments.find((row) => row.id === employmentId);
	if (!employment) refuse('Leave requires an approved employment.');
	const company = context.companies.find((row) => row.id === employment.company_id);
	if (!company) refuse('The employing company is not available.');
	const selected = context.catalogues.find((row) => row.id === catalogueId);
	if (
		!selected ||
		!context.versions.some(
			(row) => row.id === selected.settings_id && row.code === company.settings_code
		)
	)
		refuse('The leave catalogue does not belong to this employment’s settings lineage.');
	const employee = context.employees.find((row) => row.id === employment.employee_id);
	if (!employee) refuse('The employee is not available.');
	const terms = context.terms.filter((row) => row.employment_id === employmentId);
	const range = employment.effective_range;
	const hire = range == null ? '' : dateKey(range.start);
	const exit = range?.end == null ? null : dateKey(range.end);
	const settingsOn = (date: string) => {
		const row = settingsInForce(context.versions, company.settings_code, date);
		if (!row) refuse(`No sealed settings cover ${date}.`);
		return row;
	};
	const catalogueAt = (date: string) => {
		const settings = settingsInForce(context.versions, company.settings_code, date);
		return context.catalogues.find(
			(row) => row.settings_id === settings?.id && row.code === selected.code
		);
	};
	const catalogueOn = (date: string) => {
		const row = catalogueAt(date);
		if (!row) {
			settingsOn(date);
			refuse(`No ${selected.code} leave catalogue covers ${date}.`);
		}
		return row;
	};
	/**
	 * The person as a predicate sees them on one date: the terms in force that day, or none.
	 *
	 * Built once per employment and date for the whole context, not once per leave type: an
	 * entitlement projects eligibility over every day of its window, and a company of ninety with
	 * ten leave types asked for the same person three hundred thousand times a run.
	 */
	// Keyed by the facts themselves: a context is mutated in place by callers that amend terms or
	// a person between queries, so identity alone would serve a stale reading.
	const people = personCache(
		context,
		JSON.stringify([
			employee,
			terms,
			company.id,
			hire,
			exit,
			context.facts ?? [],
			context.absences ?? []
		])
	);
	const personOn = (date: string, forEvent: PersonInput['event'] = event): PersonContext => {
		const known = forEvent == null ? people.get(date) : undefined;
		if (known !== undefined) return known.person;
		const person = personAt(context, employmentId, date, forEvent);
		if (forEvent == null) people.set(date, { person, key: JSON.stringify(person) });
		return person;
	};
	const eligibility = new Map<string, boolean>();
	// A rule's verdict depends on the person's facts, not the calendar: two dates on which the
	// person reads the same are one evaluation. A year has a dozen distinct readings, not 365.
	const verdicts = eligibilityCache(context);
	/**
	 * A day of service the grant counts: employed, on terms, under a sealed version. Projection
	 * dates outside an approved policy do not earn leave; actual balance and activity dates still
	 * resolve through catalogueOn/settingsOn and refuse missing evidence.
	 */
	const servedOn = (date: string): boolean =>
		date >= hire &&
		(exit == null || date <= exit) &&
		terms.some((row) => coversDate(row.effective_range, date)) &&
		catalogueAt(date) != null;
	const eligibleOn = (date: string): boolean => {
		const known = eligibility.get(date);
		if (known !== undefined) return known;
		const catalogue = catalogueAt(date);
		let eligible = false;
		if (servedOn(date) && catalogue != null) {
			// An entry with an event is judged on it, uncached: the event is the entry's own.
			if (event != null) eligible = isEligible(catalogue.eligibility, personOn(date));
			else {
				personOn(date);
				const verdictKey = `${catalogue.eligibility}\u0000${people.get(date)!.key}`;
				const verdict = verdicts.get(verdictKey);
				if (verdict !== undefined) eligible = verdict;
				else {
					eligible = isEligible(catalogue.eligibility, personOn(date));
					verdicts.set(verdictKey, eligible);
				}
			}
		}
		eligibility.set(date, eligible);
		return eligible;
	};
	const amounts = new Map<string, ReturnType<typeof computedEntitlement>>();
	const entitlementAt = (window: LeaveWindow, date: string) => {
		const key = `${window.start}/${window.end}/${date}`;
		const known = amounts.get(key);
		if (known) return known;
		// An ended employee can settle old days later using the source period's final rule.
		const asOf = [date, window.end, ...(exit == null ? [] : [exit])].toSorted()[0]!;
		const ruleDate = asOf < window.start ? window.start : asOf;
		const result = computedEntitlement({
			rule: catalogueOn(ruleDate).entitlement,
			window,
			asOf,
			hireDate: hire,
			exitDate: exit,
			servedOn,
			eligibleOn,
			personOn
		});
		amounts.set(key, result);
		return result;
	};
	return {
		employment,
		company,
		selected,
		terms,
		hire,
		exit,
		settingsOn,
		catalogueAt,
		catalogueOn,
		eligibleOn,
		personOn,
		entitlementAt
	};
}
