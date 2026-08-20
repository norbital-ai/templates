import type { Teams } from '@norbital-ai/bolt/authoring';

/**
 * ============================================================================
 * WHICH POLICIES EACH TEAM HOLDS
 * ============================================================================
 *
 * `src/policies/` says what each policy grants; this file says who holds it. A `bolt_team` row is
 * membership, editable from the dashboard without a deploy; this map is authority, compiled into the
 * release. They are bound by **name**, case-insensitively — a team row absent from this file holds
 * nothing.
 *
 * ## The values are policy names, and a policy is named by its file
 *
 * `+field_ops_controller.policy.ts` declares `name: 'field_ops_controller'` and
 * `+field_ops_contractor.policy.ts` declares `name: 'field_ops_contractor'`, so the `field_ops_*`
 * file keys below are the policy names, the generated `PolicyName` union, and what
 * `policiesHeldByTeam` matches — one spelling rather than three.
 *
 * A channel binds the same way. `+field_ops_whatsapp.channel.ts` has always declared
 * `policy: 'field_ops_contractor'`, and `Workspace.policy` resolves it by `name`; while the policy
 * declared `Field Operations Contractor`, that lookup found nothing and the WhatsApp agent ran
 * against no ceiling at all. Both surfaces are typed as `PolicyName` now.
 *
 * ## `Field Operations Controllers` is load-bearing and must not be renamed alone
 *
 * `+field_ops_contractor.policy.ts` gates variation-request create and update behind an approval
 * whose single step lists `approvers: ['Field Operations Controllers']`. **An `approvers` entry and
 * a team name are the same string.** Renaming the key below without the constant in that file — or
 * the reverse — leaves every scope change waiting on a team nobody is in, silently and forever. It
 * is plural where the policy's `name` is singular, and that mismatch is deliberate and old: one is a
 * body of staff, the other is a capability.
 *
 * ## One team per person, and the collapse it makes visible
 *
 * `bolt_auth_user.team_id` is one team, so a combination of authority somebody actually holds has to
 * be a named team. Here that is `Contractor (Controller)` — and it is worth being blunt about what
 * that team is, because it is the case the teams design calls out by name.
 *
 * `Controller` grants every action on every collection, **unconditionally**. The contractor policy's
 * grants all narrow to the requestor — `job_assignments` by a direct comparison on
 * `assignee_user_id`, the rest by a subquery that reaches the requestor through it. `rowPredicate`
 * **unions** the `where` of every matching grant, so an unconditional grant beside a narrowed one
 * collapses the predicate to `true`: a member of `Contractor (Controller)` does not see "their own
 * jobs plus dispatch", they see everything, and the self-scoping evaporates. Two seeded people are
 * in that state today — Bob Poh and Yu Kiat Tan, who between them are the assignee of every seeded
 * assignment, so as seeded *every* contractor in this workspace is in fact unscoped. Naming the team
 * is what turns that from an emergent property of two arrays into something a diff shows — which is
 * the whole reason this file exists.
 */
export default {
	/**
	 * Dispatch. **Also the `approvers` name in `+field_ops_contractor.policy.ts`** — see above.
	 *
	 * Full command of sites, jobs, assignments, variations and photo evidence, and the only team that
	 * can decide a variation approval.
	 */
	'Field Operations Controllers': ['field_ops_controller'],

	/**
	 * The field side: their assigned jobs and sites, their own evidence.
	 *
	 * "Contractor" is a **role**, and this key is the whole of what one is. There is no collection
	 * describing a contractor and nothing to link a person to: an assignment names its assignee by
	 * `bolt_auth_user.norbital_id`, and holding this policy is what turns that person into somebody
	 * who sees only their own.
	 *
	 * That also settles where a contractor's *company* lives, which is nowhere. A team is authority,
	 * and this file is compiled into the release — a team row absent from it holds nothing — so
	 * modelling one company as one team would mean a deploy to onboard a contractor, and, because
	 * `bolt_auth_user.team_id` is one team, would leave that person unable to also be in this one.
	 */
	Contractor: ['field_ops_contractor'],

	/**
	 * A contractor who also holds dispatch — the union two seeded people carry.
	 *
	 * Read the collapse note above before putting anybody else in it: this is not "contractor plus a
	 * little more", it is unscoped access to the whole workspace. It is declared because it is what
	 * those two hold and pretending otherwise would be a silent narrowing dressed as a migration.
	 *
	 * Note what it deliberately is *not*: `Field Operations Controllers`. Approval eligibility
	 * follows the team name, not the policies, so members of this team decide nothing — which is
	 * exactly the standing they had when their `teams` array said `Contractor`.
	 */
	'Contractor (Controller)': ['field_ops_contractor', 'field_ops_controller'],

	/**
	 * The WhatsApp channel principal, which is a machine and not a body of staff.
	 *
	 * `+field_ops_whatsapp.policy.ts` grants `job_assignments` `update` and nothing else — no reads
	 * anywhere, no apps. With roles deleted there is no longer any route to a policy except a team,
	 * so the agent account the channel runs as needs one; without this entry the policy would be
	 * unreachable and the channel would hold no authority at all.
	 *
	 * No seeded person is in it, and nobody should be: a person in this team can write assignment
	 * rows they are not allowed to read.
	 */
	'WhatsApp Channel Agent': ['field_ops_whatsapp']
} satisfies Teams;
