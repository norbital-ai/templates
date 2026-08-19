import {
	claimApproval,
	employeeReferenceGrants,
	leaveApproval,
	settlementLedgerGrants,
	statutoryGrants,
	timeEntryApproval
} from '../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 1 of 4. Self-service: an employee's own record and nothing else.
 *
 * The role token is this policy's `name`, folded — see the ladder in `src/lib/policy_grants.ts`.
 *
 * The scope root here is `${requestor.email}`, not `${requestor.norbital_id}`. That is the seed's
 * choice and it is kept: an `employees` row is HR data with its own lifecycle and is not the same
 * object as a platform user, so there is no user id on it to match. The join is by address, folded on
 * both sides — `lower(p."email") = lower(${requestor.email})` — because HR imports and identity
 * providers disagree about case constantly and an exact match would show an employee an empty
 * workspace with no error.
 *
 * `${requestor.email}` is not interpolated by JavaScript: these are single-quoted strings, so the
 * literal token reaches jsonb and the policy compiler binds it as a positional parameter on every
 * request. An unknown scope path throws rather than binding null.
 *
 * `$sql`, never `RAW`. `RAW` is a function, a grant is stored as jsonb, and a dropped function leaves
 * `conditions: {}` — which the guard reads as *unconditional*. On this policy that would hand every
 * employee the whole payroll.
 */

/** Their own `employees` row. The one grant that matches on the collection's own column. */
const ownEmployeeRecord = { email: '${requestor.email}' } as const;

/** Employment rows belonging to their own employee record. */
const ownEmployment = {
	$sql:
		'"employee_id" IN (SELECT p."norbital_id" FROM "employees" p ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
} as const;

/**
 * Anything hanging off one of their own employments: terms, statutory facts, roster, loans, ledger,
 * payslips, time entries, leave requests. All of them carry `employment_id`, so one subquery covers
 * them. `component_entries` carries it too but does not use this — see `ownEntryNotAnAdjustment`.
 */
const ownEmploymentChild = {
	$sql:
		'"employment_id" IN (SELECT e."norbital_id" FROM "employments" e ' +
		'JOIN "employees" p ON p."norbital_id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
} as const;

/**
 * Their own component entries, minus the corrections HR raises about them.
 *
 * An adjustment is a `MANUAL_ADJUSTMENT` origin. The owner's rule is that adjustments are visible
 * only to the HR roles, and this is where that is enforced — in the row predicate, not by leaving
 * the screen off the employee app. An employee who guessed the collection name and queried it
 * directly gets the same answer the screen gives them, because it is the same predicate.
 *
 * `NOT_AN_ADJUSTMENT` is not reused verbatim here because a grant carries **one** `where` and this
 * one has to be both scoped and filtered; the clause is the same clause, AND-ed onto the ownership
 * subquery rather than OR-ed into a second grant. A second grant would be a union — it would show
 * the employee every adjustment in the workspace.
 */
const ownEntryNotAnAdjustment = {
	$sql:
		'"employment_id" IN (SELECT e."norbital_id" FROM "employments" e ' +
		'JOIN "employees" p ON p."norbital_id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email})) ' +
		`AND "origin"->>'kind' IS DISTINCT FROM 'MANUAL_ADJUSTMENT'`
} as const;

/**
 * A claim is a `component_entries` row distinguished only by its `origin` variant — the table also
 * holds entries HR posts directly. Leave has no such discriminator because a leave request *is*
 * `leave_requests`, which is why the leave create grant below reuses `ownEmploymentChild` unchanged.
 *
 * The variant test matters on a create: without it this grant would let an employee post any
 * component entry against their own employment, including the `MANUAL_ADJUSTMENT` only HR may
 * raise. This grant is the whole of "ordinary users may only apply standard leave and their own
 * claims" — there is no adjustment create anywhere below it to narrow.
 */
const ownClaim = {
	$sql:
		'"employment_id" IN (SELECT e."norbital_id" FROM "employments" e ' +
		'JOIN "employees" p ON p."norbital_id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email})) ' +
		`AND "origin"->>'kind' = 'CLAIM'`
} as const;

export default {
	name: 'employee',
	description: 'Employee self-service access to profile, time, requests, loans, and payslips.',
	/**
	 * Self-service first, because it is the one app nobody's rank gates.
	 *
	 * `hr_employee` shows a person their own employment: their payslips, their leave balance, their
	 * roster. Every rung of this ladder is somebody's employee, so every rung has one — and until now
	 * only `employee` listed it, which meant an HR manager could run the company's payroll and not
	 * look at their own. It is listed on every policy rather than inherited because there is nothing
	 * to inherit through: `visibleApps` reads the `apps` array of the policies a subject's roles
	 * match, and a policy that does not name the app does not offer it.
	 *
	 * The row scope is unchanged and does the actual work: the app's queries are `${requestor.email}`
	 * -scoped, so naming it here shows a person their own record and nobody else's.
	 */
	apps: ['hr_employee'],

	grants: [
		{ collection: 'employees', action: 'read', where: ownEmployeeRecord },
		{ collection: 'employments', action: 'read', where: ownEmployment },

		{ collection: 'employment_terms', action: 'read', where: ownEmploymentChild },
		{ collection: 'employment_statutory_facts', action: 'read', where: ownEmploymentChild },
		{ collection: 'roster_entries', action: 'read', where: ownEmploymentChild },
		{ collection: 'repayment_agreements', action: 'read', where: ownEmploymentChild },
		{ collection: 'payslips', action: 'read', where: ownEmploymentChild },
		{ collection: 'component_entries', action: 'read', where: ownEntryNotAnAdjustment },
		{ collection: 'time_entries', action: 'read', where: ownEmploymentChild },
		{ collection: 'leave_requests', action: 'read', where: ownEmploymentChild },

		{
			collection: 'time_entries',
			action: 'create',
			where: ownEmploymentChild,
			approval: timeEntryApproval('019efa4b-b947-755a-990e-53c8da7b855f')
		},
		{
			collection: 'component_entries',
			action: 'create',
			where: ownClaim,
			approval: claimApproval('019efa4b-b947-755a-990e-53c8da7b855e')
		},
		{
			collection: 'leave_requests',
			action: 'create',
			where: ownEmploymentChild,
			approval: leaveApproval('019efa4b-b947-755a-990e-53c8da7b856e')
		},

		// Reference data an employee needs to read their own numbers. Unconditional, and correctly so:
		// a holiday calendar and a leave type are company-wide facts, not personal records.
		...employeeReferenceGrants('read'),
		...statutoryGrants('read'),
		// Why an employee reads the settlement ledger at all: see `settlementLedgerGrants`. Without it
		// the refusal on a settled time entry is an access denial instead of an explanation.
		...settlementLedgerGrants()
	]
} satisfies Policy;
