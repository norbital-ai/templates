import { approveBy } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Policy } from '../access/policies/$types.js';

type Grants = Policy['grants'];
type Collection = keyof Grants & string;
type CollectionGrants<C extends Collection> = NonNullable<Grants[C]>;
type Action<C extends Collection> = keyof CollectionGrants<C> & string;
type Grant<C extends Collection, A extends Action<C>> = NonNullable<CollectionGrants<C>[A]>;
type ReadWhere<C extends Collection> =
	NonNullable<CollectionGrants<C>['read']> extends {
		readonly where?: infer Where;
	}
		? Where
		: never;

/**
 * Combines disjoint collection/action slots. A duplicate is an authoring error, never a merge.
 */
const addCollectionGrants = (
	merged: Record<string, Record<string, unknown>>,
	collection: string,
	actions: Record<string, unknown> | undefined
): void => {
	const target = (merged[collection] ??= {});
	for (const [action, grant] of Object.entries(actions ?? {})) {
		if (Object.hasOwn(target, action)) {
			throw new TypeError('Duplicate policy grant ' + collection + '.' + action + '.');
		}
		target[action] = grant;
	}
};

export const mergeGrants = (...parts: ReadonlyArray<Grants>): Grants => {
	const merged: Record<string, Record<string, unknown>> = {};
	for (const part of parts) {
		for (const [collection, actions] of Object.entries(part)) {
			addCollectionGrants(merged, collection, actions);
		}
	}
	return merged as Grants;
};

export const grantOn = <const C extends Collection, const A extends Action<C>>(
	collection: C,
	action: A,
	grant: Grant<C, A>
): Grants => ({ [collection]: { [action]: grant } }) as Grants;

export const grantsOn = <const C extends Collection>(
	collection: C,
	actions: ReadonlyArray<Action<C>>
): Grants =>
	({
		[collection]: Object.fromEntries(actions.map((action) => [action, {}]))
	}) as Grants;

export const grantsOnWhere = <const C extends Collection>(
	collection: C,
	actions: ReadonlyArray<'read' | 'history'>,
	where: ReadWhere<C>
): Grants =>
	({
		[collection]: Object.fromEntries(actions.map((action) => [action, { where }]))
	}) as Grants;

export const NOT_AN_ADJUSTMENT = {
	$sql: "\"origin\"->>'kind' IS DISTINCT FROM 'MANUAL_ADJUSTMENT'"
} as const;

export const ownEmploymentChild = {
	$sql:
		'"employment_id" IN (SELECT e."id" FROM "employments" e ' +
		'JOIN "employees" p ON p."id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
} as const;

export const referenceGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('rosters', actions),
		grantsOn('roster_entries', actions),
		grantsOn('pay_components', actions),
		grantsOn('leave_types', actions)
	);

export const statutoryGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('jurisdictions', actions),
		grantsOn('statutory_contributions', actions),
		grantsOn('contribution_rates', actions)
	);

const EMPLOYMENT_STATUTORY_FACT_FIELDS = [
	'employment_id',
	'statutory_contribution_id',
	'status',
	'effective_range'
] as const;

/**
 * Human statutory-fact authority excludes `supersedes_fact_id` in both write directions.
 *
 * That field is the system worker's instruction to stage a predecessor close. Letting a form or an
 * agent supply it would turn an ordinary edit into a second write. The dedicated static-identity
 * policy owns that one extra create field and routes the resulting graph through HR approval.
 */
const employmentStatutoryFactGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		...(actions.includes('read') ? [grantsOn('employment_statutory_facts', ['read'])] : []),
		...(actions.includes('create')
			? [
					grantOn('employment_statutory_facts', 'create', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('update')
			? [
					grantOn('employment_statutory_facts', 'update', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('delete') ? [grantsOn('employment_statutory_facts', ['delete'])] : [])
	);

export const peopleGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('employees', actions),
		grantsOn('employments', actions),
		grantsOn('employment_terms', actions),
		employmentStatutoryFactGrants(...actions),
		grantsOn('repayment_agreements', actions)
	);

export const payrollGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('payroll_runs', actions),
		grantsOn('payslips', actions),
		grantsOn('payslip_lines', actions),
		grantsOn('payslip_sources', actions)
	);

export const payrollRebuildGrants = (): Grants =>
	mergeGrants(grantsOn('payslips', ['delete']), grantsOn('payslip_lines', ['delete']));

export const settlementLedgerGrants = (): Grants => grantsOn('payslip_sources', ['read']);

export const employeeReferenceGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('rosters', actions),
		grantsOn('pay_components', actions),
		grantsOn('leave_types', actions)
	);

const HQ_PAYROLL_HR_TEAM = 'HQ Payroll HR' as const;
const HR_MANAGER_TEAM = 'HR Manager' as const;
const L1_MANAGER_TEAM = 'L1 Manager' as const;
const SENIOR_MANAGEMENT_TEAM = 'Senior Management' as const;

export const timeEntryApproval = {
	flow: () => approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

export const leaveApproval = {
	flow: () => approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

const claimApproval = {
	flow: () => approveBy(HQ_PAYROLL_HR_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

export const payrollRunApprovalFromController = {
	flow: () => approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [SENIOR_MANAGEMENT_TEAM]
} as const;

const employmentBelongsToRequestor = (
	employmentId: string,
	api: Parameters<NonNullable<Grant<'time_entries', 'create'>['authorize']>>[1]
) =>
	Effect.gen(function* () {
		const employment = yield* api.db.query.employments.findFirst({
			where: { id: { eq: employmentId } }
		});
		if (employment === undefined) return false;
		const employee = yield* api.db.query.employees.findFirst({
			where: { id: { eq: employment.employee_id } }
		});
		return employee?.email?.toLocaleLowerCase() === api.requestor.email?.toLocaleLowerCase();
	});

export const employeeTimeEntryCreateGrant = (): Grants =>
	grantOn('time_entries', 'create', {
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: timeEntryApproval
	});

export const employeeLeaveRequestCreateGrant = (): Grants =>
	grantOn('leave_requests', 'create', {
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: leaveApproval
	});

/** Personal reads and a claim create validated against the prepared JS candidate. */
export const employeeSelfServiceGrants = (): Grants =>
	mergeGrants(
		grantOn('payslips', 'read', { where: ownEmploymentChild }),
		grantOn('component_entries', 'create', {
			authorize: ({ record }, api) =>
				Effect.gen(function* () {
					if (record.origin.kind !== 'CLAIM') return false;
					const employment = yield* api.db.query.employments.findFirst({
						where: { id: { eq: record.employment_id } }
					});
					if (employment === undefined) return false;
					const employee = yield* api.db.query.employees.findFirst({
						where: { id: { eq: employment.employee_id } }
					});
					return employee?.email?.toLocaleLowerCase() === api.requestor.email?.toLocaleLowerCase();
				}),
			approval: claimApproval
		})
	);
