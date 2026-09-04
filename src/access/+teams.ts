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
 * A `team` row carries a name, a parent and a description, and an operator edits it from a
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
 * ## The ladder, materialized in each policy
 *
 * `policy_grants.ts` documents at length that inheritance is *materialized*: a subject carrying
 * `manager` matches only the `manager` policy, so each rank re-composes the builders of the rank
 * beneath it by hand. Each team therefore holds exactly one policy, and that policy states the
 * team's complete authority:
 *
 * ```
 *   Employee → Supervisor → L1 Manager → Senior Management        (rank)
 *                                              ▲
 *                    HQ Payroll HR → HR Manager                   (payroll authority)
 * ```
 *
 * This is a safety boundary, not only a style choice. A holder may have only one grant for a given
 * grant coordinate; the compiler rejects overlaps instead of merging them. A policy may
 * still materialize the grants of the rank beneath it, but each coordinate has one complete rule.
 *
 * ## One team per person, and what that forces
 *
 * `user.team_id` is one own team, not a set. `teamPath` carries organizational scope for SQL
 * predicates; it does not import descendant policies. Every operational authority is therefore
 * named here explicitly — see `Manager (HR Controller)` below.
 *
 * Approval flows name the exact team that may decide each stage. Broader superseding authority is
 * explicit through `superceded_by`; administrative status alone grants none.
 */
export default {
	/** Rank 1. Self-service: a person's own record, their own time, their own requests. */
	Employee: ['employee'],

	/** Rank 2. Their own, plus their reports' attendance and leave. */
	Supervisor: ['supervisor'],

	/**
	 * Rank 3, and the team an approval flow means by "the direct manager".
	 *
	 * Named `L1 Manager` rather than `Manager` because `approveBy('L1 Manager')` is checked against
	 * this generated team union. Renaming either side without the other is a compile error.
	 */
	'L1 Manager': ['manager'],

	/** Rank 4. Reads payroll; does not administer it. */
	'Senior Management': ['senior_management'],

	/**
	 * Payroll authority 1 of 2: may view payroll and may not commit it.
	 *
	 * A controller's `payroll_runs.mutate.new` grant carries an approval, so the run is written and
	 * held. `create.before` also writes payslips and junctions as the requesting subject, which is
	 * why the policy includes `payrollRebuildGrants()`. This team is also what the payroll-run
	 * approval flow routes to.
	 */
	'HQ Payroll HR': ['hr_controller'],

	/**
	 * Payroll authority 2 of 2: everything a controller may do, plus `mutate.new` without review,
	 * `mutate.existing` for re-runs, and delete.
	 */
	'HR Manager': ['hr_manager'],

	/**
	 * The named combination that used to be two policies at once.
	 *
	 * `hr_controller` already materializes every grant coordinate `manager` has, plus payroll
	 * authority, so it is the complete declaration for this team. Mapping both policies would add no
	 * capability, but it would combine their differently scoped grants and be refused as a potential
	 * widening. Nobody is in this team today; it remains named because the operational identity and
	 * approval route are real even though its authority comes from one policy.
	 */
	'Manager (HR Controller)': ['hr_controller']
} satisfies Teams;
