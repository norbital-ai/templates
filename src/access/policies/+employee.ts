import {
	OWN_EMPLOYMENT,
	leaveCalendarGrants,
	employeeSelfServiceGrants,
	employeeReferenceGrants,
	employeeLeaveRequestNewGrant,
	employeeWorkDayExistingGrant,
	employeeWorkDayNewGrant,
	grantOn,
	mergeGrants,
	statutoryGrants
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 1 of 4. Self-service: an employee's own record and nothing else.
 *
 * The policy key is this file's name, `employee` — see the ladder in `src/lib/policy_grants.ts`.
 *
 * The scope root here is `subject.email`, not `subject.id`. That is the seed's
 * choice and it is kept: an `employees` row is HR data with its own lifecycle and is not the same
 * object as a platform user, so there is no user id on it to match. The join is by address, folded on
 * both sides — `lower(p."email") = lower(subject.email)` — because HR imports and identity
 * providers disagree about case constantly and an exact match would show an employee an empty
 * workspace with no error.
 *
 * The email is a typed subject operand and the comparison uses the registered case-fold transform.
 * The compiler derives every dependency and reverse path from the declared relationship tree.
 */

/** Their own `employees` row. The one grant that matches on the collection's own column. */
const ownEmployeeRecord = {
	email: { caseFoldEq: { $subject: 'email' } }
} as const;

/** Employment rows belonging to their own employee record. */
const ownEmployment = OWN_EMPLOYMENT;
const ownEmploymentTerm = { term_employment: { some: OWN_EMPLOYMENT } } as const;
const ownEmploymentStatutoryFact = {
	statutory_fact_employment: { some: OWN_EMPLOYMENT }
} as const;
const ownWorkDay = { work_day_employment: { some: OWN_EMPLOYMENT } } as const;
const ownClaimRequest = {
	claim_request_employment: { some: OWN_EMPLOYMENT }
} as const;
const ownAllowanceRequest = {
	allowance_request_employment: { some: OWN_EMPLOYMENT }
} as const;
const ownBonusRequest = {
	bonus_request_employment: { some: OWN_EMPLOYMENT }
} as const;
const ownArrearsRequest = {
	arrears_request_employment: { some: OWN_EMPLOYMENT }
} as const;
const ownLoan = { loan_employment: { some: OWN_EMPLOYMENT } } as const;
const ownLeaveRequest = { leave_request_employment: { some: OWN_EMPLOYMENT } } as const;
const ownLeaveEntitlement = { leave_entitlement_employment: { some: OWN_EMPLOYMENT } } as const;
const ownLeaveEntry = {
	entry_leave_entitlement: { some: { leave_entitlement_employment: { some: OWN_EMPLOYMENT } } }
} as const;
const ownEmployeeChild = { child_employment: { some: OWN_EMPLOYMENT } } as const;

const ownLoanNotTheirChildren = ownLoan;

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
	 * The row scope is unchanged and does the actual work: the app's queries use `subject.email`
	 * -scoped, so naming it here shows a person their own record and nobody else's.
	 */
	capabilities: { apps: ['hr_employee'] },

	grants: mergeGrants(
		grantOn('employees', 'read', { where: ownEmployeeRecord }),
		grantOn('employments', 'read', { where: ownEmployment }),
		grantOn('employment_terms', 'read', {
			where: ownEmploymentTerm
		}),
		grantOn('employment_statutory_facts', 'read', {
			where: ownEmploymentStatutoryFact
		}),
		// One grant for the person-day, where the roster and the punch used to be two collections.
		// Reading is unmasked: a person may see their own schedule and their own clock in full.
		grantOn('work_days', 'read', {
			where: ownWorkDay
		}),
		/**
		 * Their own claims, allowances, bonuses and arrears — and no grant at all on
		 * `correction_requests`.
		 *
		 * The owner's rule is that corrections are visible only to the HR policies. That used to be
		 * a row predicate reaching two levels into a jsonb discriminator
		 * (`event -> 'kind' <> 'MANUAL_ADJUSTMENT'`), explicitly `AND`ed with the ownership path
		 * because a second grant would have been a union and would have shown the employee every
		 * correction in the workspace. A correction is its own collection now, so the rule is the
		 * absence of a grant — which cannot be widened by a union, cannot drift from the screen,
		 * and needs no predicate to state.
		 */
		grantOn('claim_requests', 'read', { where: ownClaimRequest }),
		grantOn('allowance_requests', 'read', { where: ownAllowanceRequest }),
		grantOn('bonus_requests', 'read', { where: ownBonusRequest }),
		grantOn('arrears_requests', 'read', { where: ownArrearsRequest }),
		grantOn('loans', 'read', { where: ownLoanNotTheirChildren }),
		grantOn('leave_requests', 'read', {
			where: ownLeaveRequest
		}),
		grantOn('leave_entitlements', 'read', { where: ownLeaveEntitlement }),
		grantOn('leave_entries', 'read', { where: ownLeaveEntry }),
		grantOn('employee_children', 'read', {
			where: ownEmployeeChild
		}),
		employeeWorkDayNewGrant(),
		employeeWorkDayExistingGrant(),
		// `employeeSelfServiceGrants` already carries `settlementLedgerGrants` — the read mask the
		// lock refusals quote — so restating it here would be a duplicate grant, which
		// `mergeGrants` refuses.
		employeeSelfServiceGrants(),
		employeeLeaveRequestNewGrant(),
		employeeReferenceGrants('read'),
		leaveCalendarGrants(true),
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
