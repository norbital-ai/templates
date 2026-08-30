import { policySql } from '@norbital-ai/bolt/authoring';
import {
	employeeSelfServiceGrants,
	employeeReferenceGrants,
	employeeLeaveRequestNewGrant,
	employeeWorkDayExistingGrant,
	employeeWorkDayNewGrant,
	grantOn,
	mergeGrants,
	ownEmploymentChild,
	statutoryGrants
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 1 of 4. Self-service: an employee's own record and nothing else.
 *
 * The policy key is this file's name, `employee` — see the ladder in `src/lib/policy_grants.ts`.
 *
 * The scope root here is `${requestor.email}`, not `${requestor.id}`. That is the seed's
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
 * `policySql`, never `RAW`. `RAW` is a function, a grant is stored as jsonb, and a dropped function
 * leaves `conditions: {}` — which the guard reads as *unconditional*. On this policy that would
 * hand every employee the whole payroll.
 */

/** Their own `employees` row. The one grant that matches on the collection's own column. */
const ownEmployeeRecord = { email: '${requestor.email}' } as const;

/** Employment rows belonging to their own employee record. */
const ownEmployment = policySql(
	'"employee_id" IN (SELECT p."id" FROM "employees" p ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
);

/**
 * Their own component entries, minus the corrections HR raises about them.
 *
 * The owner's rule is that corrections are visible only to the HR policies, and this is where that
 * is enforced — in the row predicate, not by leaving the screen off the employee app. An employee
 * who guessed the collection name and queried it directly gets the same answer the screen gives
 * them, because it is the same predicate. Their loans are a separate collection with no hiding to
 * do, so they read plainly.
 *
 * `NOT_A_CORRECTION` is not reused verbatim here because a grant carries **one** `where` and this
 * one has to be both scoped and filtered; the clause is the same clause, AND-ed onto the ownership
 * subquery rather than OR-ed into a second grant. A second grant would be a union — it would show
 * the employee every correction in the workspace.
 */
const ownEntryNotACorrection = policySql(
	'"employment_id" IN (SELECT e."id" FROM "employments" e ' +
		'JOIN "employees" p ON p."id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email})) ' +
		`AND "event"->>'kind' IS DISTINCT FROM 'MANUAL_ADJUSTMENT'`
);
const ownLoanNotTheirChildren = policySql(
	'"employment_id" IN (SELECT e."id" FROM "employments" e ' +
		'JOIN "employees" p ON p."id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
);

/**
 * Exact linking collections for sync generations. The target collection is omitted because Bolt
 * always owns its direct-write generation edge.
 */
const employeeScopeDependencies = ['employees'] as const;
const employmentScopeDependencies = ['employments', 'employees'] as const;

export default {
	description: 'Employee self-service access to profile, time, requests, loans, and payslips.',
	/**
	 * Self-service first, because it is the one app nobody's rank gates.
	 *
	 * `hr_employee` shows a person their own employment: their payslips, their leave balance, their
	 * roster. Every rung of this ladder is somebody's employee, so every rung has one — and until now
	 * only `employee` listed it, which meant an HR manager could run the company's payroll and not
	 * look at their own. It is listed on every policy rather than inherited because there is nothing
	 * to inherit through: `visibleApps` reads the `apps` array of the policies a subject's team
	 * confers, and a policy that does not name the app does not offer it.
	 *
	 * The row scope is unchanged and does the actual work: the app's queries are `${requestor.email}`
	 * -scoped, so naming it here shows a person their own record and nobody else's.
	 */
	capabilities: { apps: ['hr_employee'] },

	grants: mergeGrants(
		grantOn('employees', 'read', { where: ownEmployeeRecord }),
		grantOn('employments', 'read', {
			where: ownEmployment,
			dependencies: employeeScopeDependencies
		}),
		grantOn('employment_terms', 'read', {
			where: ownEmploymentChild,
			dependencies: employmentScopeDependencies
		}),
		grantOn('employment_statutory_facts', 'read', {
			where: ownEmploymentChild,
			dependencies: employmentScopeDependencies
		}),
		// One grant for the person-day, where the roster and the punch used to be two collections.
		// Reading is unmasked: a person may see their own schedule and their own clock in full.
		grantOn('work_days', 'read', {
			where: ownEmploymentChild,
			dependencies: employmentScopeDependencies
		}),
		grantOn('component_entries', 'read', {
			where: ownEntryNotACorrection,
			dependencies: employmentScopeDependencies
		}),
		grantOn('loans', 'read', {
			where: ownLoanNotTheirChildren,
			dependencies: employmentScopeDependencies
		}),
		grantOn('leave_requests', 'read', {
			where: ownEmploymentChild,
			dependencies: employmentScopeDependencies
		}),
		grantOn('employee_children', 'read', {
			where: ownEmploymentChild,
			dependencies: employmentScopeDependencies
		}),
		employeeWorkDayNewGrant(),
		employeeWorkDayExistingGrant(),
		// `employeeSelfServiceGrants` already carries `settlementLedgerGrants` — the read mask the
		// lock refusals quote — so restating it here would be a duplicate grant, which
		// `mergeGrants` refuses.
		employeeSelfServiceGrants(),
		employeeLeaveRequestNewGrant(),
		employeeReferenceGrants('read'),
		statutoryGrants('read')
	),
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
