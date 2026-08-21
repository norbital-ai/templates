import type { Teams } from '@norbital-ai/bolt/authoring';

/**
 * ============================================================================
 * WHICH POLICIES EACH TEAM HOLDS
 * ============================================================================
 *
 * The other half of `src/lib/policy_grants.ts`. That file says what each policy *grants*; this one
 * says who *holds* it. Between them they are the whole of authority in this workspace.
 *
 * ## Why this is code and membership is not
 *
 * A `bolt_team` row carries a name, a parent and a description, and an operator edits it from a
 * dashboard without a deploy — because who is on which team changes constantly, and waiting for a
 * release to move somebody between teams would be absurd.
 *
 * What a team may *do* is this file, compiled into the release. A row that granted a policy would be
 * a privilege escalation performed with an `update` statement, in a place no diff, no review and no
 * type check can see. Membership is an operational fact; authority is a reviewed one.
 *
 * The two are bound by **name**, matched case-insensitively. A team row whose name is absent here
 * holds no policies — inert, not broken — so an operator may create a team before the code that
 * gives it authority ships, and a release that drops a team removes its authority without orphaning
 * anybody.
 *
 * ## The ladder, composed by membership rather than by copying
 *
 * `policy_grants.ts` documents at length that inheritance is *materialized*: a subject carrying
 * `manager` matches only the `manager` policy, so each rank re-composes the builders of the rank
 * beneath it by hand. That is still true of the policy files. What changes here is that a **team**
 * may hold several policies, so the ladder is stated once, as a list, in the place a person is
 * actually placed:
 *
 * ```
 *   Employee → Supervisor → L1 Manager → Senior Management        (rank)
 *                                              ▲
 *                    HQ Payroll HR → HR Manager                   (payroll authority)
 * ```
 *
 * Each entry below lists the whole set rather than pointing at the rung beneath it, deliberately:
 * `rowPredicate` **unions** the `where` of every matching grant, so what a team confers is the union
 * of its policies whatever order they are written in — and a list you can read top to bottom is
 * worth more here than a derivation you have to run in your head. Runtime also includes policies
 * mapped to descendant teams in `teamPath`; descent is unconditional and there is no second
 * `inherits` switch. These explicit arrays state what each team contributes before that union.
 *
 * ## One team per person, and what that forces
 *
 * `bolt_auth_user.team_id` is one own team, not a set. Descendant teams may add policies through
 * `teamPath`, but an operational unit that directly carries an orthogonal combination should still
 * be named here — see `Manager (HR Controller)` below. That makes its direct authority visible in a
 * diff instead of depending on an incidental runtime hierarchy.
 *
 * It is also why every approval step in `policy_grants.ts` now lists each team that may decide it.
 * A step naming one team would be decidable only by that exact team, locking out every rung above
 * it.
 */
export default {
	/** Rank 1. Self-service: a person's own record, their own time, their own requests. */
	Employee: ['employee'],

	/** Rank 2. Their own, plus their reports' attendance and leave. */
	Supervisor: ['employee', 'supervisor'],

	/**
	 * Rank 3, and the team an approval step means by "the direct manager".
	 *
	 * Named `L1 Manager` rather than `Manager` because that is the name the approval steps already
	 * carry, and a step's `approvers` entry and a team's name are the same string. Renaming either
	 * without the other is what produces an approval nobody can decide.
	 */
	'L1 Manager': ['employee', 'supervisor', 'manager'],

	/** Rank 4. Reads payroll; does not administer it. */
	'Senior Management': ['employee', 'supervisor', 'manager', 'senior_management'],

	/**
	 * Payroll authority 1 of 2: may view payroll and may not commit it.
	 *
	 * A controller's `payroll_runs` create carries an approval, so the run is written and held. This
	 * team is also what `claimApproval` routes to.
	 */
	'HQ Payroll HR': ['employee', 'hr_controller'],

	/**
	 * Payroll authority 2 of 2: everything a controller may do, plus create without review, re-run
	 * and delete.
	 */
	'HR Manager': ['employee', 'supervisor', 'manager', 'hr_controller', 'hr_manager'],

	/**
	 * The combination that used to be two roles at once.
	 *
	 * `policy_grants.ts` notes that the special roles are orthogonal to rank, "so a person may hold
	 * `manager` *and* `hr_controller`". This named team states that direct union without relying on
	 * descendant-team topology. Nobody is in it today; it exists because the combination is real and
	 * the ladder describes it, and discovering that at the moment somebody needs it is worse than
	 * declaring it now.
	 */
	'Manager (HR Controller)': ['employee', 'supervisor', 'manager', 'hr_controller']
} satisfies Teams;
