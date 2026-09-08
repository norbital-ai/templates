import { resolveEmployment, type ResolvedEmployment } from '../employment-contract.js';
import { Effect } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_entries/$types.js';
import type { LeaveWindow } from '../../datatypes/leave_event/+definition.js';
import { withPendingLeaveEntries, type LeaveActivity } from './pending.js';
import { computedEntitlement } from './entitlement.js';
import { dateKey } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';

type ReadTables =
	| 'employments'
	| 'employees'
	| 'companies'
	| 'jurisdiction_settings'
	| 'leave_catalogue'
	| 'employment_terms'
	| 'employee_children'
	| 'work_days'
	| 'shift_patterns'
	| 'shift_definitions'
	| 'jurisdiction_holiday_calendars'
	| 'payroll_runs'
	| 'payslip_leave_inputs'
	| 'payslips';
export type LeaveReadApi = {
	db: { [K in ReadTables]: Pick<Api<WorkspaceSchema>['db'][K], 'findMany'> } & {
		leave_entries: Pick<Api<WorkspaceSchema>['db']['leave_entries'], 'findMany' | 'findPending'>;
	};
};
const LIMIT = 20_000;
function complete<T>(rows: T[], name: string): T[] {
	if (rows.length >= LIMIT)
		refuse(`The ${name} read reached its safety ceiling; leave cannot be verified.`);
	return rows;
}

export type LeaveContext = {
	employments: Pick<
		ResolvedEmployment,
		'id' | 'employee_id' | 'company_id' | 'hire_date' | 'exit_date'
	>[];
	companies: Pick<WorkspaceRow<'companies'>, 'id' | 'settings_code'>[];
	employees: Pick<WorkspaceRow<'employees'>, 'id' | 'gender' | 'date_of_birth' | 'nationality'>[];
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
	>[];
	children: Pick<
		WorkspaceRow<'employee_children'>,
		'id' | 'employment_id' | 'child_birthdate' | 'supersedes_id' | 'effective_range'
	>[];
	entries: LeaveActivity[];
	versions: Pick<
		WorkspaceRow<'jurisdiction_settings'>,
		| 'id'
		| 'code'
		| 'currency'
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
		| 'is_statutory'
		| 'requires_certificate_after_days'
		| 'payroll_effect'
		| 'encashment'
	>[];
	calendars: Pick<
		WorkspaceRow<'jurisdiction_holiday_calendars'>,
		'id' | 'jurisdiction_code' | 'year' | 'revision' | 'observations' | 'published_at'
	>[];
	workDays: Pick<
		WorkspaceRow<'work_days'>,
		'id' | 'employment_id' | 'work_date' | 'shift_definition_id'
	>[];
	runs: Pick<
		WorkspaceRow<'payroll_runs'>,
		'id' | 'company_id' | 'period' | 'lifecycle' | 'attendance_from' | 'attendance_to'
	>[];
	patterns: Pick<WorkspaceRow<'shift_patterns'>, 'id' | 'code' | 'pattern' | 'effective_range'>[];
	shifts: Pick<
		WorkspaceRow<'shift_definitions'>,
		'id' | 'company_id' | 'variant' | 'effective_range'
	>[];
	captures: Pick<
		WorkspaceRow<'payslip_leave_inputs'>,
		'leave_entry_id' | 'payslip_id' | 'gross_amount' | 'charges' | 'pay_items'
	>[];
	payslips: Pick<WorkspaceRow<'payslips'>, 'id' | 'payroll_run_id'>[];
};

/** One batched, guarded read of employment history and manual activity. No balance rows or writes. */
export function readLeaveContext(
	api: LeaveReadApi,
	employmentIds: readonly string[],
	window?: LeaveWindow,
	includeSettlements = false
): Effect.Effect<LeaveContext> {
	return Effect.gen(function* () {
		const ids = [...new Set(employmentIds)];
		const employments = complete(
			yield* api.db.employments.findMany({
				where: { id: { in: ids }, approval_id: { isNull: true } },
				with: { employment_departure: { where: { approval_id: { isNull: true } } } },
				columns: {
					id: true,
					employee_id: true,
					company_id: true,
					hire_date: true,
					effective_range: true
				},
				limit: LIMIT
			}),
			'employments'
		).map(resolveEmployment);
		const companyIds = [...new Set(employments.map((row) => row.company_id))];
		const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
		const [companies, employees, terms, children, stored, workDays, runs, patterns, shifts] =
			yield* Effect.all(
				[
					api.db.companies.findMany({
						where: { id: { in: companyIds }, approval_id: { isNull: true } },
						columns: { id: true, settings_code: true },
						limit: LIMIT
					}),
					api.db.employees.findMany({
						where: { id: { in: employeeIds }, approval_id: { isNull: true } },
						columns: {
							id: true,
							gender: true,
							date_of_birth: true,
							nationality: true
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
							payroll_group: true
						},
						limit: LIMIT
					}),
					api.db.employee_children.findMany({
						where: { employment_id: { in: ids }, approval_id: { isNull: true } },
						columns: {
							id: true,
							employment_id: true,
							child_birthdate: true,
							supersedes_id: true,
							effective_range: true
						},
						limit: LIMIT
					}),
					api.db.leave_entries.findMany({
						where: { employment_id: { in: ids }, approval_id: { isNull: true } },
						columns: {
							id: true,
							employment_id: true,
							leave_catalogue_id: true,
							leave_code: true,
							reference: true,
							event: true,
							charges: true,
							allocations: true,
							approval_id: true
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
					api.db.payroll_runs.findMany({
						where: { company_id: { in: companyIds }, approval_id: { isNull: true } },
						columns: {
							id: true,
							company_id: true,
							period: true,
							lifecycle: true,
							attendance_from: true,
							attendance_to: true
						},
						limit: LIMIT
					}),
					api.db.shift_patterns.findMany({
						where: {
							company_id: { in: window == null ? [] : companyIds },
							approval_id: { isNull: true }
						},
						columns: { id: true, code: true, pattern: true, effective_range: true },
						limit: LIMIT
					}),
					api.db.shift_definitions.findMany({
						where: {
							company_id: { in: window == null ? [] : companyIds },
							approval_id: { isNull: true }
						},
						columns: { id: true, company_id: true, variant: true, effective_range: true },
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		for (const [rows, name] of [
			[companies, 'companies'],
			[employees, 'employees'],
			[terms, 'terms'],
			[children, 'child facts'],
			[stored, 'leave entries'],
			[workDays, 'workdays'],
			[runs, 'payroll runs'],
			[patterns, 'shift patterns'],
			[shifts, 'shift definitions']
		] as const)
			complete<unknown>(rows, name);
		const versions = complete(
			yield* api.db.jurisdiction_settings.findMany({
				where: {
					code: { in: [...new Set(companies.map((row) => row.settings_code))] },
					approval_id: { isNull: true }
				},
				columns: {
					id: true,
					code: true,
					jurisdiction_code: true,
					sealed_at: true,
					currency: true,
					voided_at: true,
					effective_range: true,
					approval_id: true
				},
				limit: LIMIT
			}),
			'settings versions'
		);
		const catalogues = complete(
			yield* api.db.leave_catalogue.findMany({
				where: {
					settings_id: { in: versions.map((row) => row.id) },
					approval_id: { isNull: true }
				},
				columns: {
					id: true,
					settings_id: true,
					code: true,
					name: true,
					eligibility: true,
					entitlement: true,
					is_statutory: true,
					requires_certificate_after_days: true,
					payroll_effect: true,
					encashment: true
				},
				limit: LIMIT
			}),
			'leave catalogues'
		);
		const calendars = complete(
			yield* api.db.jurisdiction_holiday_calendars.findMany({
				where: {
					jurisdiction_code: {
						in: window == null ? [] : [...new Set(versions.map((row) => row.jurisdiction_code))]
					},
					...(window == null
						? {}
						: {
								year: { gte: Number(window.start.slice(0, 4)), lte: Number(window.end.slice(0, 4)) }
							}),
					approval_id: { isNull: true }
				},
				columns: {
					id: true,
					jurisdiction_code: true,
					year: true,
					revision: true,
					observations: true,
					published_at: true
				},
				limit: LIMIT
			}),
			'holiday calendars'
		);
		const entries = yield* withPendingLeaveEntries(api, ids, stored);
		const captures = !includeSettlements
			? []
			: complete(
					yield* api.db.payslip_leave_inputs.findMany({
						where: {
							leave_entry_id: { in: stored.map((row) => row.id) },
							approval_id: { isNull: true }
						},
						columns: {
							leave_entry_id: true,
							payslip_id: true,
							gross_amount: true,
							charges: true,
							pay_items: true
						},
						limit: LIMIT
					}),
					'leave captures'
				);
		const payslips =
			captures.length === 0
				? []
				: complete(
						yield* api.db.payslips.findMany({
							where: {
								id: { in: [...new Set(captures.map((row) => row.payslip_id))] },
								approval_id: { isNull: true }
							},
							columns: { id: true, payroll_run_id: true },
							limit: LIMIT
						}),
						'capturing payslips'
					);
		return {
			employments,
			companies,
			employees,
			terms,
			children,
			entries,
			versions,
			catalogues,
			calendars,
			workDays,
			runs,
			patterns,
			shifts,
			captures,
			payslips
		};
	});
}

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
	const children = context.children.filter((row) => row.employment_id === employmentId);
	const superseded = new Set(
		children.flatMap((row) => (row.supersedes_id == null ? [] : [row.supersedes_id]))
	);
	const hire = dateKey(employment.hire_date);
	const exit = employment.exit_date == null ? null : dateKey(employment.exit_date);
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
	const eligibility = new Map<string, boolean>();
	const eligibleOn = (date: string): boolean => {
		const known = eligibility.get(date);
		if (known !== undefined) return known;
		const term = terms.find((row) => coversDate(row.effective_range, date));
		// Projection dates outside an approved policy do not earn leave. Actual balance and
		// activity dates still resolve through catalogueOn/settingsOn and refuse missing evidence.
		const catalogue = catalogueAt(date);
		const active = date >= hire && (exit == null || date <= exit) && term != null;
		const eligible =
			active &&
			catalogue != null &&
			isEligible(
				catalogue.eligibility,
				personContext({
					employee,
					employment,
					terms: term,
					children: children.filter(
						(row) =>
							!superseded.has(row.id) &&
							(row.effective_range == null || coversDate(row.effective_range, date))
					),
					asOf: date
				})
			);
		eligibility.set(date, eligible);
		return eligible;
	};
	const amounts = new Map<string, ReturnType<typeof computedEntitlement>>();
	const entitlementAt = (window: LeaveWindow, date: string) => {
		const key = `${window.start}/${window.end}/${date}`;
		const known = amounts.get(key);
		if (known) return known;
		// An ended employee can settle old days later using the source period’s final rule.
		const asOf = [date, window.end, ...(exit == null ? [] : [exit])].toSorted()[0]!;
		const ruleDate = asOf < window.start ? window.start : asOf;
		const result = computedEntitlement({
			rule: catalogueOn(ruleDate).entitlement,
			window,
			asOf,
			hireDate: hire,
			exitDate: exit,
			eligibleOn
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
