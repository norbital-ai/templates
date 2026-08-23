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
 * This is a safety boundary, not only a style choice. `rowPredicate` **unions** the `where` of every
 * matching grant, so an unconditional grant from one held policy erases a narrowed grant from
 * another. The compiler refuses that composition instead of silently widening access. A policy may
 * still materialize the grants of the rank beneath it, but the result is reviewed and validated as
 * one declaration rather than assembled from independently safe declarations at runtime.
 *
 * ## One team per person, and what that forces
 *
 * `user.team_id` is one own team, not a set. Descendant teams may contribute authority
 * through `teamPath`, but an operational unit that carries a distinct authority should still be
 * named here — see `Manager (HR Controller)` below. Its singleton mapping makes the effective
 * authority visible in a diff instead of depending on a multi-policy union or incidental topology.
 *
 * It is also why every approval step in `policy_grants.ts` now lists each team that may decide it.
 * A step naming one team would be decidable only by that exact team, locking out every rung above
 * it.
 */
export default {
	/** Rank 1. Self-service: a person's own record, their own time, their own requests. */
	Employee: ['employee'],

	/** Rank 2. Their own, plus their reports' attendance and leave. */
	Supervisor: ['supervisor'],

	/**
	 * Rank 3, and the team an approval step means by "the direct manager".
	 *
	 * Named `L1 Manager` rather than `Manager` because that is the name the approval steps already
	 * carry, and a step's `approvers` entry and a team's name are the same string. Renaming either
	 * without the other is what produces an approval nobody can decide.
	 */
	'L1 Manager': ['manager'],

	/** Rank 4. Reads payroll; does not administer it. */
	'Senior Management': ['senior_management'],

	/**
	 * Payroll authority 1 of 2: may view payroll and may not commit it.
	 *
	 * A controller's `payroll_runs` create carries an approval, so the run is written and held. This
	 * team is also what `claimApproval` routes to.
	 */
	'HQ Payroll HR': ['hr_controller'],

	/**
	 * Payroll authority 2 of 2: everything a controller may do, plus create without review, re-run
	 * and delete.
	 */
	'HR Manager': ['hr_manager'],

	/**
	 * The named combination that used to be two policies at once.
	 *
	 * `hr_controller` already materializes every collection/action pair `manager` has, plus payroll
	 * authority, so it is the complete declaration for this team. Mapping both policies would add no
	 * capability, but it would combine their differently scoped grants and be refused as a potential
	 * widening. Nobody is in this team today; it remains named because the operational identity and
	 * approval route are real even though its authority comes from one policy.
	 */
	'Manager (HR Controller)': ['hr_controller']
} satisfies Teams;
