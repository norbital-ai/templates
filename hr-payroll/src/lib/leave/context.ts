import { childrenOn, resolveEmployment, type ResolvedEmployment } from '../employment-contract.js';
import { Effect } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_entries/$types.js';
import type { LeaveWindow } from './entitlement.js';
import { withPendingLeaveEntries, type LeaveActivity } from './pending.js';
import { normaliseLeaveDays } from './activity-fields.js';
import { computedEntitlement } from './entitlement.js';
import { dateKey } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import {
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';

/**
 * The leave type off-in-lieu days are recorded under. Its catalogue row is
 * `availability: UNLIMITED` with no bands, and HR records every movement by hand — an ADJUSTMENT
 * to grant, a TIME_OFF to take, a REVERSAL to return — so the computed entitlement is zero and
 * the approved entries are the whole balance.
 */
const LIEU_LEAVE_CODE = 'PUBLIC_HOLIDAY_IN_LIEU';

type ReadTables =
	| 'employments'
	| 'employees'
	| 'companies'
	| 'jurisdiction_settings'
	| 'statutory_contributions'
	| 'leave_catalogue'
	| 'employment_terms'
	| 'work_days'
	| 'shift_patterns'
	| 'shift_definitions'
	| 'jurisdiction_holidays'
	| 'payroll_runs'
	| 'payslips';
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
	employments: Pick<ResolvedEmployment, 'id' | 'employee_id' | 'company_id' | 'effective_range'>[];
	companies: Pick<WorkspaceRow<'companies'>, 'id' | 'settings_code' | 'region'>[];
	employees: Pick<
		WorkspaceRow<'employees'>,
		| 'id'
		| 'gender'
		| 'date_of_birth'
		| 'nationality'
		| 'marital_status'
		| 'solo_parent'
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
	>[];
	entries: LeaveActivity[];
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
	>[];
	holidays: Pick<
		WorkspaceRow<'jurisdiction_holidays'>,
		'id' | 'company_id' | 'date' | 'name' | 'kind' | 'replaces' | 'given_to' | 'published_at'
	>[];
	workDays: Pick<
		WorkspaceRow<'work_days'>,
		'id' | 'employment_id' | 'work_date' | 'shift_definition_id'
	>[];
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
					columns: { id: true, employee_id: true, company_id: true, effective_range: true },
					with: {
						employment_employee: {
							columns: {
								id: true,
								gender: true,
								date_of_birth: true,
								nationality: true,
								marital_status: true,
								solo_parent: true,
								race: true,
								religion: true,
								children: true
							}
						},
						employment_company: { columns: { id: true, settings_code: true, region: true } }
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
						residency_since: true
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
						payslip_id: true
					},
					limit: LIMIT
				}),
				api.db.work_days.findMany({
					where: {
						employment_id: { in: window == null ? [] : ids },
						...(window == null ? {} : { work_date: { gte: window.start, lte: window.end } }),
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
						approval_id: true
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
		const employments = employmentRows.map((row) =>
			resolveEmployment({
				id: row.id,
				employee_id: row.employee_id,
				company_id: row.company_id,
				effective_range: row.effective_range
			})
		);
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
		const settingsCodes = new Set(companies.map((row) => row.settings_code));
		const lineage = versions.filter((row) => settingsCodes.has(row.code));
		const stored = allEntries.filter((row) => row.approval_id == null).map(normaliseLeaveDays);
		// A settled entry names its payslip directly. The payslip's stored adjustments are the
		// frozen evidence a reversal negates.
		const settlingIds = [
			...new Set(stored.flatMap((row) => (row.payslip_id == null ? [] : [row.payslip_id])))
		];
		const [catalogues, runs, patterns, shifts, holidays, payslips] = yield* Effect.all(
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
						can_encash: true
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
						...(window == null ? {} : { date: { gte: window.start, lte: window.end } }),
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
						})
			],
			{ concurrency: 'unbounded' }
		);
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
		return {
			employments,
			companies,
			employees,
			terms,
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

/** Resolve a stable leave code against the sealed catalogue and person facts effective on each date. */
export function leaveRules(context: LeaveContext, employmentId: string, catalogueId: string) {
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
	const people = personCache(context, JSON.stringify([employee, terms, company.id, hire, exit]));
	const personOn = (date: string): PersonContext => {
		const known = people.get(date);
		if (known !== undefined) return known.person;
		const person = personContext({
			employee,
			employment: { service_start: hire },
			terms: terms.find((row) => coversDate(row.effective_range, date)) ?? null,
			children: childrenOn(employee.children ?? [], date),
			company,
			asOf: date
		});
		people.set(date, { person, key: JSON.stringify(person) });
		return person;
	};
	const eligibility = new Map<string, boolean>();
	// A rule's verdict depends on the person's facts, not the calendar: two dates on which the
	// person reads the same are one evaluation. A year has a dozen distinct readings, not 365.
	const verdicts = eligibilityCache(context);
	const eligibleOn = (date: string): boolean => {
		const known = eligibility.get(date);
		if (known !== undefined) return known;
		const term = terms.find((row) => coversDate(row.effective_range, date));
		// Projection dates outside an approved policy do not earn leave. Actual balance and
		// activity dates still resolve through catalogueOn/settingsOn and refuse missing evidence.
		const catalogue = catalogueAt(date);
		const active = date >= hire && (exit == null || date <= exit) && term != null;
		let eligible = false;
		if (active && catalogue != null) {
			personOn(date);
			const verdictKey = `${catalogue.eligibility}\u0000${people.get(date)!.key}`;
			const verdict = verdicts.get(verdictKey);
			if (verdict !== undefined) eligible = verdict;
			else {
				eligible = isEligible(catalogue.eligibility, personOn(date));
				verdicts.set(verdictKey, eligible);
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
		// Earned by credit only: no schedule grants days, so the meter starts at zero and every
		// debit must be funded by a posted lieu credit in the same window. `opening` is unread
		// downstream; the window start stands in for it.
		if (selected.code === LIEU_LEAVE_CODE) {
			const zeroed = {
				window,
				opening: window.start,
				unlimited: false,
				entitlement: 0,
				earned: 0,
				available: 0
			};
			amounts.set(key, zeroed);
			return zeroed;
		}
		// An ended employee can settle old days later using the source period's final rule.
		const asOf = [date, window.end, ...(exit == null ? [] : [exit])].toSorted()[0]!;
		const ruleDate = asOf < window.start ? window.start : asOf;
		const result = computedEntitlement({
			rule: catalogueOn(ruleDate).entitlement,
			window,
			asOf,
			hireDate: hire,
			exitDate: exit,
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
		entitlementAt
	};
}
