import { resolveEmployment } from '../employment-contract.js';
import { getErrorMessage, refuse } from '../refuse.js';
import { readAll, type Reads } from '../reads.js';
import type { StoredRange } from '../../lib/payroll/run/effective.js';
import type { LeaveWindow } from './entitlement.js';
import { withPendingLeaveEntries, type LeaveActivity } from './pending.js';
import { activeTimeOff } from './activity.js';
import { normaliseLeaveDays } from './activity-fields.js';
import { completedLeaveServiceMonths, computedEntitlement, leaveWindowOf } from './entitlement.js';
import { dateKey } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import type { CompanyFactRevision } from '../declared-facts.js';
import { coversDate, readRange } from '../../lib/payroll/run/effective.js';
import { addDays, daysBetween, inclusiveDays, monthDay } from '../../lib/payroll/run/dates.js';
import { rosterCodeKind, workWindow } from '../scheduling/roster-code.js';
import { resolveHolidays } from '../holiday-calendar.js';
import { personCondition } from '../scheduled/entries.js';
import {
	patternAnchor,
	patternDaysPerWeek,
	patternRosterCodeId,
	patternWorkload,
	termPatternRow
} from '../scheduling/work-pattern.js';
import { hourlyLeaveBasis } from './hourly-requirement.js';
import { decodeNumber } from '../wire.js';
import * as Predicate from 'effect/Predicate';
import { resolveCompanyFacts } from '../declared-facts.js';
import { personFactsForVersion } from '../payroll/facts.js';
import {
	DATED,
	evaluatePersonNumber,
	isEligible,
	personContext,
	type DatedCompany,
	type PersonContext,
	type PersonInput
} from '../../lib/payroll/run/eligibility.js';
import type { WorkspaceRow } from '../rows.js';
import {
	declaresBenefitCases,
	readCaseEvidence,
	type CaseEvidence
} from '../benefit-cases/benefit.js';
import type { HolidayRow } from '../holiday-calendar.js';
import type { FactKey } from '../datatypes/fact_keys.js';
import type { LeaveEntitlement } from '../datatypes/leave_entitlement.js';
import type { PayrollSettings } from '../datatypes/payroll_settings.js';
import type { PayslipAdjustment } from '../datatypes/payslip_adjustments.js';
import type { RosterCodeVariant } from '../datatypes/roster_code_variant.js';
import type { StatutoryFactStatus } from '../datatypes/statutory_fact_status.js';
import type { WorkPattern } from '../datatypes/work_pattern.js';

/** A 0.0.1 `period` of dates as stored: `{ from, to }`, both inclusive (`effective.ts` reads either shape). */
type Period = { readonly from: string; readonly to: string | null };

export type LeaveContext = {
	employments: {
		readonly id: string;
		readonly employee_id: string;
		readonly company_id: string;
		readonly effective_range: StoredRange | null;
		readonly exit_ground?: string | null | undefined;
		readonly exit_facts?: Readonly<Record<string, unknown>> | null | undefined;
		readonly prior_service_months?: number | null | undefined;
	}[];
	companies: {
		readonly id: string;
		readonly settings_code: string;
		readonly region: string | null;
		readonly pay_frequency: string;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
		/** Dated entity fact revisions, so a leave rule reads the facts of its own date. */
		readonly fact_revisions?: readonly CompanyFactRevision[] | undefined;
		/** The version's tables and worksites on a date, where the caller bound them (a lifecycle check). */
		readonly [DATED]?: DatedCompany | undefined;
	}[];
	employees: {
		readonly id: string;
		readonly gender: string | null;
		readonly date_of_birth: string | null;
		readonly nationality: string | null;
		readonly marital_status: string | null;
		readonly solo_parent: boolean;
		readonly disabled: boolean;
		readonly race: string | null;
		readonly religion: string | null;
		readonly children: WorkspaceRow<'employees'>['children'];
	}[];
	terms: {
		readonly id: string;
		readonly employment_id: string;
		readonly effective_range: Period | StoredRange;
		readonly shift_pattern_id: string | null;
		/** Where a local holiday reaches (`jurisdiction_holidays.worksite`). */
		readonly worksite?: string | null;
		readonly ordinary_hours_per_week: number | null;
		readonly comparable_full_time_daily_hours?: number | null;
		readonly comparable_full_time_weekly_hours?: number | null;
		readonly comparable_full_time_presence?: string | null;
		readonly employment_type: string;
		readonly residency_status: string | null;
		readonly work_classification: string | null;
		readonly base_salary: number;
		readonly currency: string;
		readonly statutory_work_category: string | null;
		readonly department: string | null;
		readonly payroll_group: string | null;
		readonly paid_rest_days: boolean;
		readonly grade: string | null;
		readonly residency_since: string | null;
		readonly pay_frequency: string;
		readonly pass_type: string | null;
		readonly tax_residency: string | null;
		readonly notice_days: number | null;
		/** The opening attendance declaration (`employment_terms.opening_*`); absent is none. */
		readonly opening_attendance_through?: string | null;
		readonly opening_unexcused_absence_days?: number | string | null;
	}[];
	/** The lineage's scheme codes, so `facts.<CODE>` reads false rather than failing for an unregistered one. */
	schemeCodes?: string[] | undefined;
	schemes?:
		| Array<{ id: string; code: string; settings_id: string; elections: readonly FactKey[] }>
		| undefined;
	/** Statutory facts by employee, with the scheme's code resolved: what `person.facts.<CODE>` reads; absent is none. */
	facts?: {
		employee_id: string;
		employment_id: string | null;
		statutory_contribution_id: string;
		code: string;
		effective_range: Period | StoredRange;
		status: StatutoryFactStatus;
	}[];
	entries: LeaveActivity[];
	/**
	 * The benefit cases of these employments, where the lineage declares a case type: a per-event
	 * grant reads its event's case facts (`event.case.facts`), with the cases' fact evidence.
	 */
	benefitCases?: WorkspaceRow<'benefit_cases'>[] | undefined;
	benefitEvidence?: (CaseEvidence & { readonly subject: unknown })[] | undefined;
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
	versions: {
		readonly id: string;
		readonly code: string;
		readonly payroll: PayrollSettings;
		readonly jurisdiction_code: string;
		readonly sealed_at: string | null;
		readonly voided_at: string | null;
		readonly effective_range: Period | StoredRange;
		readonly approval_id: string | null;
		readonly facts: readonly FactKey[];
		readonly exit_facts: readonly FactKey[];
	}[];
	catalogues: {
		readonly id: string;
		readonly settings_id: string;
		readonly code: string;
		readonly name: string;
		readonly eligibility: string;
		readonly entitlement: LeaveEntitlement;
		readonly evidence_after_days: number | null;
		readonly is_npl: boolean;
		readonly requires_no_pay_origin?: boolean;
		readonly can_encash: boolean;
		readonly encash_on_exit: boolean;
		readonly pay_fraction: string;
		readonly paid_by: 'EMPLOYER' | 'FUND';
		readonly consumes_code: string | null;
		readonly unit: 'DAY' | 'HOUR';
		/** The event or state inputs an entry of this row records (`leave.facts.<key>`). */
		readonly event_facts?: readonly FactKey[] | null;
	}[];
	holidays: HolidayRow[];
	workDays: {
		readonly id: string;
		readonly employment_id: string;
		readonly work_date: string;
		readonly shift_definition_id: string | null;
	}[];
	/** Dated attendance and absence decisions across the current and carried annual windows. */
	annualAttendance?: {
		readonly employment_id: string;
		readonly work_date: string;
		readonly shift_definition_id: string | null;
		readonly worked_intervals:
			readonly { readonly start: string; readonly end: string | null }[] | null;
		/** `work_day_facts`: the absence decision inputs (`ABSENCE_DECISION_FACTS`) among them. */
		readonly facts?: Readonly<Record<string, unknown>> | null;
	}[];
	/**
	 * A projection of a window that has not closed (a no-pay leave replanning the year's annual
	 * balance): absence forfeiture stays provisional, since the year's attendance is not all in.
	 */
	projected?: boolean;
	/** A balance read (`leave_balances`): a forfeiture refusal becomes a warning beside the grant. */
	balanceRead?: boolean;
	/**
	 * Rostered days read and found empty — absent without leave — by employment and day, over
	 * the twelve months before the window; what `employment.absent_days_12m` counts. Absent is
	 * none counted.
	 */
	absences?: { employment_id: string; work_date: string }[] | undefined;
	runs: {
		readonly id: string;
		readonly company_id: string;
		readonly period: string;
		readonly kind?: string | null;
		readonly attendance_from: string;
		readonly attendance_to: string;
	}[];
	patterns: {
		readonly id: string;
		readonly code: string;
		readonly pattern: WorkPattern;
		readonly effective_range: Period | StoredRange;
	}[];
	shifts: {
		readonly id: string;
		readonly company_id: string;
		readonly code: string;
		readonly variant: RosterCodeVariant;
		readonly effective_range: Period | StoredRange;
	}[];
	payslips: {
		readonly id: string;
		readonly payroll_run_id: string;
		readonly employment_id: string;
		readonly currency: string;
		readonly paid_at: string | null;
		readonly adjustments: readonly PayslipAdjustment[];
	}[];
};

type Stored<T> = T & { readonly approval_id: string | null };
const unique = (values: readonly string[]): string[] => [...new Set(values)];
const settled = { approval_id: { isNull: true } } as const;
/** Two leave years of at most 366 days: the current entitlement window and its carry source. */
const ANNUAL_LOOKBACK_DAYS = 732;

/**
 * One batched read of employment history and manual activity, as the workspace (a transform's
 * `ctx.db`) or as the caller (a query's or automation's `ctx`), in three waves. No writes.
 *
 * Wave 1 is keyed by the employment ids alone: the employments, their terms, every leave entry
 * (held proposals included), the window's work days and every settings version. Wave 2 is keyed
 * by what wave 1 named: the people, the entities and their dated facts, runs, roster vocabulary,
 * holidays, the payslips that settled a reversed entry, the people's other employments, their
 * statutory facts and the year of absences before the window. Wave 3 is the lineage's catalogues
 * and schemes (the lineage is the entities' settings code) and the other employments' time off.
 */
export async function readLeaveContext(
	reads: Reads,
	employmentIds: readonly string[],
	window?: LeaveWindow,
	includeSettlements = false
): Promise<LeaveContext> {
	const ids = unique(employmentIds);
	const [employmentRows, terms, allEntries, workDayRows, versionRows] = await Promise.all([
		readAll<Stored<LeaveContext['employments'][number]> & { readonly effective_range: Period }>(
			reads,
			'employments',
			{ id: { in: ids }, ...settled }
		),
		readAll<LeaveContext['terms'][number]>(reads, 'employment_terms', {
			employment_id: { in: ids },
			...settled
		}),
		readAll<LeaveActivity>(reads, 'leave_entries', { employment_id: { in: ids } }),
		window == null
			? []
			: readAll<LeaveContext['workDays'][number]>(reads, 'work_days', {
					employment_id: { in: ids },
					work_date: { gte: window.start, lte: window.end },
					...settled
				}),
		readAll<LeaveContext['versions'][number]>(reads, 'jurisdiction_settings', settled, undefined, {
			id: true,
			code: true,
			payroll: true,
			jurisdiction_code: true,
			sealed_at: true,
			voided_at: true,
			effective_range: true,
			approval_id: true,
			facts: true,
			exit_facts: true
		})
	]);
	const employments = employmentRows.map((row) => ({
		...resolveEmployment({
			id: row.id,
			employee_id: row.employee_id,
			company_id: row.company_id,
			effective_range: row.effective_range
		}),
		exit_ground: row.exit_ground ?? null,
		exit_facts: row.exit_facts ?? null,
		prior_service_months: row.prior_service_months ?? null
	}));
	const companyIds = unique(employments.map((row) => row.company_id));
	const employeeIds = unique(employments.map((row) => row.employee_id));
	const stored = allEntries.filter((row) => row.approval_id == null).map(normaliseLeaveDays);
	// A settled entry names its payslip directly. The payslip's stored adjustments are the
	// frozen evidence a reversal negates.
	const settlingIds = unique(
		stored.flatMap((row) => (row.payslip_id == null ? [] : [row.payslip_id]))
	);
	const [
		employees,
		companyRows,
		factRevisions,
		runs,
		patterns,
		shifts,
		holidays,
		payslips,
		siblings,
		factRows,
		emptyDays
	] = await Promise.all([
		readAll<LeaveContext['employees'][number]>(reads, 'employees', { id: { in: employeeIds } }),
		readAll<LeaveContext['companies'][number]>(reads, 'companies', { id: { in: companyIds } }),
		// The entity's dated facts; a leave rule reads the revision in force on its own date.
		readAll<CompanyFactRevision & { readonly company_id: string }>(reads, 'company_facts', {
			company_id: { in: companyIds },
			...settled
		}),
		readAll<LeaveContext['runs'][number]>(reads, 'payroll_runs', {
			company_id: { in: companyIds },
			...settled
		}),
		// The roster vocabulary belongs to the entity, which the employment read names.
		window == null
			? []
			: readAll<LeaveContext['patterns'][number]>(reads, 'shift_patterns', {
					company_id: { in: companyIds },
					...settled
				}),
		window == null
			? []
			: readAll<LeaveContext['shifts'][number]>(reads, 'shift_definitions', {
					company_id: { in: companyIds },
					...settled
				}),
		// The entities of the employments in scope, not their jurisdictions: a holiday belongs to
		// the employer that observes it.
		window == null
			? []
			: readAll<LeaveContext['holidays'][number]>(reads, 'jurisdiction_holidays', {
					company_id: { in: companyIds },
					date: { gte: addDays(window.end, -ANNUAL_LOOKBACK_DAYS), lte: window.end },
					published_at: { isNull: false },
					...settled
				}),
		!includeSettlements || settlingIds.length === 0
			? []
			: readAll<LeaveContext['payslips'][number]>(reads, 'payslips', {
					id: { in: settlingIds },
					...settled
				}),
		// The people's other employments here, for what a lifetime counts (MY s.60FA(2): five
		// confinements; SG GPCL: 42 days a child) across a rehire.
		readAll<{ readonly id: string; readonly employee_id: string }>(reads, 'employments', {
			employee_id: { in: employeeIds },
			...settled
		}),
		readAll<Omit<NonNullable<LeaveContext['facts']>[number], 'code'>>(
			reads,
			'employment_statutory_facts',
			{ employee_id: { in: employeeIds }, ...settled }
		),
		// Two annual windows through the requested date: current entitlement and the carry source.
		window == null
			? []
			: readAll<NonNullable<LeaveContext['annualAttendance']>[number]>(reads, 'work_days', {
					employment_id: { in: ids },
					work_date: { gte: addDays(window.end, -ANNUAL_LOOKBACK_DAYS), lte: window.end },
					...settled
				})
	]);
	const companies = companyRows.map((row) => ({
		...row,
		fact_revisions: factRevisions.filter((revision) => revision.company_id === row.id)
	}));
	const settingsCodes = new Set(companies.map((row) => row.settings_code));
	const lineage = versionRows.filter((row) => settingsCodes.has(row.code));
	const lineageIds = lineage.map((row) => row.id);
	const inScope = new Set(ids);
	const others = siblings.filter((row) => !inScope.has(row.id));
	const employeeOf = new Map(others.map((row) => [row.id, row.employee_id]));
	const [catalogues, schemes, priorRows, benefitCases] = await Promise.all([
		readAll<LeaveContext['catalogues'][number]>(reads, 'leave_catalogue', {
			settings_id: { in: lineageIds },
			...settled
		}),
		// The lineage's schemes name the codes a rule reads a fact under (`facts.SI.since_months`). Only the four fields
		// leave reads, in one crossing: whole rows carry the rule tables and page 4 to a crossing past the budget.
		readAll<NonNullable<LeaveContext['schemes']>[number]>(
			reads,
			'statutory_contributions',
			{ settings_id: { in: lineageIds }, ...settled },
			undefined,
			{ id: true, code: true, settings_id: true, elections: true }
		),
		others.length === 0
			? []
			: readAll<LeaveActivity>(reads, 'leave_entries', {
					employment_id: { in: others.map((row) => row.id) },
					...settled
				}),
		declaresBenefitCases(lineage)
			? readAll<WorkspaceRow<'benefit_cases'>>(reads, 'benefit_cases', {
					employment_id: { in: ids },
					...settled
				})
			: []
	]);
	const benefitEvidence = await readCaseEvidence(
		reads,
		benefitCases.map((row) => row.id)
	);
	const workCodeIds = new Set(
		shifts.filter((row) => rosterCodeKind(row.variant) === 'WORK').map((row) => row.id)
	);
	const absences = emptyDays.flatMap((row) =>
		row.worked_intervals?.length === 0 &&
		row.shift_definition_id != null &&
		workCodeIds.has(row.shift_definition_id)
			? [{ employment_id: row.employment_id, work_date: dateKey(row.work_date) }]
			: []
	);
	const codeOfScheme = new Map(schemes.map((row) => [row.id, row.code]));
	const facts = factRows.flatMap((row) => {
		const code = codeOfScheme.get(row.statutory_contribution_id);
		return code == null ? [] : [{ ...row, code }];
	});
	const entries = withPendingLeaveEntries(
		allEntries.filter((row) => row.approval_id != null).map(normaliseLeaveDays),
		stored
	);
	return {
		employments,
		priorEntries: priorRows.map((row) => ({
			...normaliseLeaveDays(row),
			employee_id: employeeOf.get(row.employment_id) ?? ''
		})),
		companies,
		employees,
		terms,
		schemeCodes: [...new Set(codeOfScheme.values())],
		schemes: schemes.map(({ id, code, settings_id, elections }) => ({
			id,
			code,
			settings_id,
			elections
		})),
		facts,
		absences,
		annualAttendance: emptyDays,
		entries,
		benefitCases,
		benefitEvidence,
		versions: lineage,
		catalogues,
		holidays,
		workDays: workDayRows,
		runs,
		patterns,
		shifts,
		payslips
	};
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

/** The employment's approved time off by leave code, as calendar spans (MY s.60E(3B) reads them). */
function leaveSpans(context: LeaveContext, employmentId: string) {
	return activeTimeOff(
		context.entries.filter((row) => row.employment_id === employmentId && row.approval_id == null)
	).map((row) => ({
		code: row.leave_code,
		from: dateKey(row.from_date),
		to: dateKey(row.to_date)
	}));
}

/** The person of one employment on one date, as every leave rule reads them; uncached. */
export function personAt(
	context: LeaveContext,
	employmentId: string,
	date: string,
	event?: PersonInput['event'],
	/** One recorded child (its index in the employee's children), as if the only one. */
	childIndex?: number
): PersonContext {
	const employment = context.employments.find((row) => row.id === employmentId);
	if (!employment) refuse('Leave requires an approved employment.');
	const company = context.companies.find((row) => row.id === employment.company_id);
	if (!company) refuse('The employing company is not available.');
	const employee = context.employees.find((row) => row.id === employment.employee_id);
	if (!employee) refuse('The employee is not available.');
	const lineage = context.versions.filter((row) => row.code === company.settings_code);
	const settings = settingsInForce(lineage, company.settings_code, date);
	const versionIds = new Set(lineage.map((row) => row.id));
	const terms = context.terms.filter((row) => row.employment_id === employmentId);
	const range = employment.effective_range;
	// The same day twelve calendar months back (29 February → 28 February), not 365 days.
	const yearBefore = monthDay(
		decodeNumber(date.slice(0, 4)) - 1,
		decodeNumber(date.slice(5, 7)) - 1,
		decodeNumber(date.slice(8, 10))
	);
	const term = terms.find((row) => coversDate(row.effective_range, date)) ?? null;
	// The contract's week, so a part-timer's grant can be read against their contracted hours
	// (`entitlement.scale`): the stated hours, else the pattern's.
	const pattern = context.patterns.find((row) => row.id === term?.shift_pattern_id)?.pattern;
	const shiftById = new Map(context.shifts.map((row) => [row.id, row]));
	const week =
		term == null || pattern == null
			? null
			: {
					ordinary_hours_per_week:
						(term.ordinary_hours_per_week ?? 0) ||
						(patternWorkload(pattern, shiftById)?.average_weekly_paid_minutes ?? 0) / 60,
					working_days_per_week: patternDaysPerWeek(pattern, shiftById)
				};
	return personContext({
		event: event ?? null,
		employee,
		employment: {
			service_start: range == null ? '' : dateKey(range.start),
			prior_service_months: employment.prior_service_months ?? 0,
			exit_date: range?.end == null ? null : dateKey(range.end),
			exit_ground: employment.exit_ground ?? null,
			exit_facts: employment.exit_facts ?? {},
			absent_days_12m: (context.absences ?? []).filter(
				(row) =>
					row.employment_id === employmentId && row.work_date > yearBefore && row.work_date <= date
			).length
		},
		leaveSpans: leaveSpans(context, employmentId),
		terms: term,
		week,
		children: (employee.children ?? []).filter(
			(_, index) => childIndex == null || index === childIndex
		),
		company: {
			...company,
			facts: resolveCompanyFacts(settings?.facts ?? [], company, {
				asOf: date,
				revisions: company.fact_revisions ?? []
			})
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
				: personFactsForVersion(
						(context.facts ?? []).filter((fact) => fact.employee_id === employee.id),
						context.schemes.filter((scheme) => versionIds.has(scheme.settings_id)),
						settings?.id ?? '',
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
	// Service counted net of requested whole no-pay days (`entitlement.service_excludes_no_pay`).
	const netService =
		selected.entitlement.service_excludes_no_pay === 'EMPLOYEE_REQUESTED_FULL_DAYS';
	const noPayDays = new Map<string, number>();
	let unknownNoPay: string | undefined;
	let unsupportedNoPay: string | undefined;
	let partialNoPay: string | undefined;
	if (netService)
		for (const row of activeTimeOff(
			context.entries.filter(
				(entry) => entry.employment_id === employmentId && entry.approval_id == null
			)
		)) {
			if (
				context.catalogues.find((catalogue) => catalogue.id === row.catalogue_id)?.is_npl !== true
			)
				continue;
			const from = dateKey(row.from_date);
			const to = dateKey(row.to_date);
			if (from === '' || to < hire) continue;
			if (row.no_pay_origin == null) {
				unknownNoPay = unknownNoPay == null || from < unknownNoPay ? from : unknownNoPay;
				continue;
			}
			if (row.no_pay_origin !== 'EMPLOYEE_REQUESTED') {
				unsupportedNoPay =
					unsupportedNoPay == null || from < unsupportedNoPay ? from : unsupportedNoPay;
				continue;
			}
			if (
				row.half_day_start === true ||
				row.half_day_end === true ||
				row.charges.some((charge) => charge.days < 1 - 1e-9)
			)
				partialNoPay = partialNoPay == null || from < partialNoPay ? from : partialNoPay;
			for (const day of daysBetween(from < hire ? hire : from, to)) {
				const charges = row.charges.filter((charge) => charge.date === day);
				const portion =
					charges.length > 0
						? charges.reduce((sum, charge) => sum + charge.days, 0)
						: day === from && row.half_day_start === true
							? 0.5
							: day === to && row.half_day_end === true
								? 0.5
								: 1;
				if (!Number.isFinite(portion) || portion <= 0 || portion > 1 + 1e-9)
					refuse('No-pay leave needs a valid day fraction in its recorded period.');
				noPayDays.set(day, (noPayDays.get(day) ?? 0) + portion);
			}
		}
	const firstNoPay = [...noPayDays.keys()].toSorted()[0];
	const noPayThrough = (date: string): number =>
		[...noPayDays].reduce((sum, [day, amount]) => sum + (day <= date ? amount : 0), 0);
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
	// a person between queries, so identity alone would serve a stale reading. The employment's
	// exit ground and exit facts are part of the person, so they are part of the key.
	const people = personCache(
		context,
		JSON.stringify([
			employee,
			terms,
			company.id,
			hire,
			exit,
			context.employments.find((row) => row.id === employmentId)?.exit_ground ?? null,
			context.employments.find((row) => row.id === employmentId)?.exit_facts ?? {},
			context.facts ?? [],
			context.absences ?? [],
			leaveSpans(context, employmentId)
		])
	);
	const personOn = (date: string, forEvent: PersonInput['event'] = event): PersonContext => {
		const known = forEvent == null ? people.get(date) : undefined;
		if (known !== undefined) return known.person;
		const person = personAt(context, employmentId, date, forEvent);
		if (forEvent == null) people.set(date, { person, key: JSON.stringify(person) });
		return person;
	};
	const servicePersonOn = (date: string, inclusive: boolean): PersonContext => {
		const person = personOn(date);
		if (!netService || date < hire) return person;
		const last = inclusive ? date : addDays(date, -1);
		const serviceDays =
			last < hire ? 0 : Math.max(0, inclusiveDays(hire, last) - noPayThrough(last));
		const equivalent = addDays(hire, Math.floor(serviceDays));
		const months = completedLeaveServiceMonths(hire, serviceDays);
		const year = Number.parseInt(hire.slice(0, 4), 10);
		const month = Number.parseInt(hire.slice(5, 7), 10) - 1;
		const day = Number.parseInt(hire.slice(8, 10), 10);
		const from = monthDay(year, month + months, day);
		const to = monthDay(year, month + months + 1, day);
		const monthsExact =
			months +
			(inclusiveDays(from, equivalent) - 1 + (serviceDays - Math.floor(serviceDays))) /
				(inclusiveDays(from, to) - 1);
		return {
			...person,
			employment: {
				...person.employment,
				service_days: serviceDays,
				service_months: months,
				service_months_exact: monthsExact,
				service_years: Math.floor(months / 12)
			}
		};
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
	const eligibleOnDay = (date: string): boolean => {
		const known = eligibility.get(date);
		if (known !== undefined) return known;
		const catalogue = catalogueAt(date);
		let eligible = false;
		if (servedOn(date) && catalogue != null) {
			// An entry with an event is judged on it, uncached: the event is the entry's own.
			if (event != null) eligible = isEligible(catalogue.eligibility, servicePersonOn(date, false));
			else {
				const person = servicePersonOn(date, false);
				const verdictKey = `${catalogue.eligibility}\u0000${netService ? JSON.stringify(person) : people.get(date)!.key}`;
				const verdict = verdicts.get(verdictKey);
				if (verdict !== undefined) eligible = verdict;
				else {
					eligible = isEligible(catalogue.eligibility, person);
					verdicts.set(verdictKey, eligible);
				}
			}
		}
		eligibility.set(date, eligible);
		return eligible;
	};
	/**
	 * A row that `qualifies_window` stays eligible for the rest of a leave year once it qualifies
	 * on a day of it: the qualifying facts are the year's, so a child who turns 7 mid-year keeps
	 * the year (SG CDCA s.12B(1)(b)), while the service qualifying period still bars the days
	 * before it is served. The grant itself is the year's once the facts hold at the close of any
	 * day of it (`grantedOn`): three months served by the end of 31 December earn the year's days
	 * even though none is left to take them in.
	 */
	const qualified = new Map<string, string | null>();
	const qualifiedFrom = (date: string, close: boolean): string | null | undefined => {
		const rule = catalogueAt(date)?.entitlement;
		if (rule?.qualifies_window !== true || event != null || !servedOn(date)) return undefined;
		const window = leaveWindowOf(date, rule, hire);
		const key = `${close}/${window.start}`;
		if (!qualified.has(key))
			qualified.set(
				key,
				daysBetween(window.start, window.end).find((day) =>
					close
						? servedOn(day) && isEligible(catalogueAt(day)!.eligibility, personOn(addDays(day, 1)))
						: eligibleOnDay(day)
				) ?? null
			);
		return qualified.get(key);
	};
	const eligibleOn = (date: string): boolean => {
		const first = qualifiedFrom(date, false);
		return first === undefined ? eligibleOnDay(date) : first != null && first <= date;
	};
	const grantedOn = (date: string): boolean => {
		if (netService && servedOn(date))
			return isEligible(catalogueOn(date).eligibility, servicePersonOn(date, true));
		const first = qualifiedFrom(date, true);
		return first === undefined ? eligibleOnDay(date) : first != null && first <= date;
	};
	const amounts = new Map<
		string,
		{
			readonly window: LeaveWindow;
			readonly opening: string | null;
			readonly unit: 'DAY' | 'HOUR';
			readonly unlimited: boolean;
			readonly entitlement: number | null;
			readonly earned: number | null;
			readonly available: number | null;
			readonly automaticCarryFrom: LeaveWindow | null;
			/** The most of this year's unused days that carry into the next (`carry_max_days`). */
			readonly carryMax: number | null;
		}
	>();
	const rosterCodes = new Map(context.shifts.map((row) => [row.id, row]));
	const hourlyBasisOn = (day: string) => {
		const term = terms.find((row) => coversDate(row.effective_range, day));
		if (term == null) return null;
		return hourlyLeaveBasis(
			catalogueOn(day).entitlement,
			term,
			context.patterns.find((row) => row.id === term.shift_pattern_id)?.pattern ?? null,
			rosterCodes
		);
	};
	/**
	 * A normal working day of the roster: the pattern of the terms in force, or of the nearest terms
	 * for a day outside them (a part first or last month counts the whole month's working days).
	 */
	const patternRows = new Map(context.patterns.map((row) => [row.id, row]));
	const datedTerms = terms.toSorted((a, b) =>
		dateKey(readRange(a.effective_range)?.start).localeCompare(
			dateKey(readRange(b.effective_range)?.start)
		)
	);
	const normalWorkingDayOn = (day: string): boolean => {
		const term =
			datedTerms.find((row) => coversDate(row.effective_range, day)) ??
			(day < hire ? datedTerms[0] : datedTerms.at(-1));
		const pattern = term == null ? null : termPatternRow(term, patternRows);
		if (pattern == null) refuse(`${selected.code} needs a work pattern to count working days.`);
		const shift = rosterCodes.get(
			patternRosterCodeId(pattern.pattern, day, patternAnchor(pattern)) ?? ''
		);
		if (shift == null) refuse(`${selected.code} needs a dated roster code on ${day}.`);
		return rosterCodeKind(shift.variant) === 'WORK';
	};
	/**
	 * Whether the window's grant is forfeited: unexcused whole-day absences above `share` of its
	 * working days (`entitlement.forfeit_above_absence_share`), each day's decision read from its
	 * recorded absence inputs. Days on and before the terms' opening attendance declaration were
	 * decided outside the workspace: they still count toward the working days, and the declared
	 * unexcused days stand for their absences. A forfeiture needs proof of the absence: a day with
	 * no dated evidence (before the workspace's attendance or the person's records) is never read
	 * as absent, so it forfeits nothing and is named in `warnings` beside the balance. A missing
	 * record refuses only when recorded absences would forfeit the grant.
	 */
	const forfeited = (
		window: LeaveWindow,
		asOf: string,
		share: number | null | undefined
	): boolean => {
		if (share == null) return false;
		const what = `${selected.code} forfeiture`;
		const declared = terms.filter((row) => row.opening_attendance_through != null);
		const openedThrough = dateKey(declared[0]?.opening_attendance_through);
		const openingAbsent = decodeNumber(declared[0]?.opening_unexcused_absence_days ?? 0);
		if (
			declared.some(
				(row) =>
					dateKey(row.opening_attendance_through) !== openedThrough ||
					decodeNumber(row.opening_unexcused_absence_days ?? 0) !== openingAbsent
			)
		)
			refuse(`${what} needs one opening attendance declaration.`);
		// The declared count is the service year holding the opening day; an earlier year has none.
		if (openedThrough > window.end && window.end >= hire) {
			warnings.add(
				`${what} for the service year ending ${window.end} has no recorded absences; the opening attendance declaration (${openedThrough}) counts only the service year holding it, so nothing is forfeited.`
			);
			return false;
		}
		// A coverage gap matters only if recorded absences would forfeit the grant.
		const uncounted: string[] = [];
		const unrecorded: string[] = [];
		const recorded = new Map(
			(context.annualAttendance ?? [])
				.filter((row) => row.employment_id === employmentId)
				.map((row) => [dateKey(row.work_date), row])
		);
		const overrides = new Map(
			context.workDays
				.filter((row) => row.employment_id === employmentId)
				.map((row) => [dateKey(row.work_date), row])
		);
		const patterns = new Map(context.patterns.map((row) => [row.id, row]));
		const approved = activeTimeOff(
			context.entries.filter((row) => row.employment_id === employmentId && row.approval_id == null)
		);
		const holidays = resolveHolidays(
			context.holidays,
			company.id,
			window.start,
			window.end,
			(date) => terms.find((row) => coversDate(row.effective_range, date))?.worksite,
			personCondition(personOn)
		);
		let withoutHolidays = 0;
		let withHolidays = 0;
		let unexcused = 0;
		for (const day of daysBetween(window.start, asOf < window.end ? asOf : window.end)) {
			if (day < hire || (exit != null && day > exit)) continue;
			const decided = day <= openedThrough;
			const gap = (message: string) => uncounted.push(message);
			const term = terms.find((row) => coversDate(row.effective_range, day));
			if (term == null) {
				gap(`${what} needs employment terms on ${day}.`);
				continue;
			}
			const pattern = termPatternRow(term, patterns);
			if (pattern == null || !coversDate(pattern.effective_range, day)) {
				gap(`${what} needs a dated work pattern on ${day}.`);
				continue;
			}
			const row = recorded.get(day);
			const codeId =
				row?.shift_definition_id ??
				overrides.get(day)?.shift_definition_id ??
				patternRosterCodeId(pattern.pattern, day, patternAnchor(pattern));
			const shift = context.shifts.find(
				(candidate) => candidate.id === codeId && candidate.company_id === company.id
			);
			if (shift == null || !coversDate(shift.effective_range, day)) {
				gap(`${what} needs a dated roster code on ${day}.`);
				continue;
			}
			if (rosterCodeKind(shift.variant) !== 'WORK') continue;
			withHolidays += 1;
			const holiday = holidays.has(day);
			if (!holiday) withoutHolidays += 1;
			if (decided) continue;
			const facts: Readonly<Record<string, unknown>> = row?.facts ?? {};
			if (facts.partial_absence === true)
				refuse(`${what} needs a statutory partial-day absence convention.`);
			const covered = approved
				.flatMap((entry) => entry.charges)
				.filter((charge) => charge.date === day)
				.reduce((sum, charge) => sum + charge.days, 0);
			if (covered >= 1 - 1e-9) continue;
			if (covered > 0 && row?.worked_intervals?.length === 0)
				refuse(`${what} needs a statutory partial-day absence convention.`);
			if (
				row?.worked_intervals == null &&
				(facts.absence_permission != null || facts.absence_reasonable_excuse != null)
			)
				refuse(`${selected.code} absence decision needs dated attendance evidence.`);
			if (holiday) continue;
			if (row?.worked_intervals == null) {
				// No dated evidence is no proof of an unauthorised absence. Before the accrual year
				// closes this is provisional; a final balance names the days it could not test.
				if (context.projected !== true && (asOf >= window.end || (exit != null && asOf >= exit)))
					unrecorded.push(day);
				continue;
			}
			if (row.worked_intervals.length > 0) {
				const paidMinutes = workWindow(shift.variant)?.paid_minutes;
				const observedMinutes = row.worked_intervals.reduce(
					(sum, interval) =>
						sum +
						(interval.end == null
							? Number.NaN
							: (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000),
					0
				);
				if (
					!Number.isFinite(observedMinutes) ||
					paidMinutes == null ||
					observedMinutes < paidMinutes * (1 - covered)
				)
					refuse(`${what} needs a partial-day attendance decision on ${day}.`);
			}
			if (row.worked_intervals.length !== 0) continue;
			if (
				facts.absence_permission == null ||
				facts.absence_reasonable_excuse == null ||
				!Predicate.isString(facts.absence_decision) ||
				facts.absence_decision.trim() === ''
			)
				refuse(
					`${selected.code} absence on ${day} needs permission, excuse and reference evidence.`
				);
			if (facts.absence_permission === 'NO' && facts.absence_reasonable_excuse === 'NO')
				unexcused += 1;
		}
		if (openedThrough >= window.start) unexcused += openingAbsent;
		const unproven = () => {
			const first = uncounted[0] ?? unrecorded[0];
			if (first != null)
				warnings.add(
					uncounted[0] ??
						`${what} for ${window.start}–${window.end}: ${unrecorded.length} working day(s) from ${first} have no dated attendance or leave evidence, so nothing is forfeited for them.`
				);
			return false;
		};
		if (unexcused === 0) return unproven();
		if (uncounted.length > 0) refuse(uncounted[0]!);
		if (
			hire > window.start ||
			(exit != null && exit < window.end) ||
			asOf < window.end ||
			[...noPayDays.keys()].some((day) => day >= window.start && day <= window.end)
		)
			refuse(`${what} needs its partial-year accrual period assessed.`);
		if (withoutHolidays === 0 || withHolidays === 0)
			refuse(`${what} needs a working-day denominator.`);
		// A share is exact when its fraction is: 52 of 260 is 0.2, not above it.
		const withoutResult = unexcused / withoutHolidays > share;
		const withResult = unexcused / withHolidays > share;
		if (withoutResult !== withResult)
			refuse(`${what} needs its public-holiday denominator assessed.`);
		// Recorded absences alone above the share are proof; below it, an untested day proves nothing.
		return withoutResult || unproven();
	};
	/** Non-blocking notes on the balance: forfeiture tests a missing record could not decide. */
	const warnings = new Set<string>();
	const entitlementAt = (window: LeaveWindow, date: string) => {
		if (unknownNoPay != null && unknownNoPay <= window.end)
			refuse(`${selected.code} needs the no-pay leave request origin recorded.`);
		if (unsupportedNoPay != null && unsupportedNoPay <= window.end)
			refuse(`${selected.code} needs the other-origin no-pay leave service basis assessed.`);
		if (partialNoPay != null && partialNoPay <= window.end)
			refuse(`${selected.code} with partial no-pay leave needs its service fraction assessed.`);
		if (firstNoPay != null && firstNoPay < window.start)
			refuse(`${selected.code} after no-pay leave needs a shifted service year assessed.`);
		if ([...noPayDays].some(([day, days]) => day <= window.end && days > 1 + 1e-9))
			refuse('Overlapping no-pay leave periods need reconciliation before annual leave is priced.');
		const key = `${window.start}/${window.end}/${date}`;
		const known = amounts.get(key);
		if (known) return known;
		// An ended employee can settle old days later using the source period's final rule.
		const asOf = [date, window.end, ...(exit == null ? [] : [exit])].toSorted()[0]!;
		const ruleDate = asOf < window.start ? window.start : asOf;
		const rule = catalogueOn(ruleDate).entitlement;
		const entitlement = computedEntitlement({
			rule,
			window,
			asOf,
			hireDate: hire,
			exitDate: exit,
			servedOn,
			eligibleOn: grantedOn,
			personOn: (day) => servicePersonOn(day, false),
			serviceExcludedOn: netService ? (day) => noPayDays.get(day) ?? 0 : undefined,
			hourlyBasisOn,
			normalWorkingDayOn
		});
		// A balance read shows the grant with the refusal beside it; a write refuses.
		let lost = false;
		try {
			lost = forfeited(window, asOf, rule.forfeit_above_absence_share);
		} catch (error) {
			if (
				context.balanceRead !== true ||
				!(Predicate.hasProperty(error, 'kind') && error.kind === 'refused')
			)
				throw error;
			warnings.add(getErrorMessage(error));
		}
		const previousEnd = addDays(window.start, -1);
		const previousRule = previousEnd < hire ? null : catalogueAt(previousEnd)?.entitlement;
		const previousWindow =
			previousRule?.auto_carry_one_year === true
				? leaveWindowOf(previousEnd, previousRule, hire)
				: null;
		if (previousWindow != null && previousWindow.end !== previousEnd)
			refuse('A changed leave-year anchor needs prior credit reconciled before carry.');
		const result = {
			...entitlement,
			entitlement: lost ? 0 : entitlement.entitlement,
			earned: lost ? 0 : entitlement.earned,
			available: lost ? 0 : entitlement.available,
			automaticCarryFrom: previousWindow,
			carryMax:
				rule.carry_max_days == null
					? null
					: Predicate.isString(rule.carry_max_days)
						? Math.max(0, evaluatePersonNumber(rule.carry_max_days, personOn(asOf)))
						: rule.carry_max_days
		};
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
		/** The person seen with one recorded child only, for a per-child cap (`child_lifetime`). */
		childPersonOn: (date: string, index: number) =>
			personAt(context, employmentId, date, undefined, index),
		children: employee.children ?? [],
		entitlementAt,
		warnings,
		/**
		 * The year a window carries from, from the catalogue alone: `entitlementAt` also prices the
		 * opening day, and every refusal on that day would land on an unrelated carry read.
		 */
		carryFrom: (window: LeaveWindow) => {
			const previousEnd = addDays(window.start, -1);
			if (previousEnd < hire) return null;
			const previousRule = catalogueAt(previousEnd)?.entitlement;
			if (previousRule?.auto_carry_one_year !== true) return null;
			const source = leaveWindowOf(previousEnd, previousRule, hire);
			return source.end === previousEnd ? source : null;
		}
	};
}
