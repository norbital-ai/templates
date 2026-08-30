import type { Teams } from '@norbital-ai/bolt/authoring';

/**
 * ============================================================================
 * WHICH POLICIES EACH TEAM HOLDS
 * ============================================================================
 *
 * `src/access/policies/` says what each policy grants; this file says who holds it. A `team` row is
 * membership, editable from the dashboard without a deploy; this map is authority, compiled into the
 * release. They are bound by **name**, case-insensitively — a team row absent from this file holds
 * nothing.
 *
 * ## The values are policy names, and a policy is named by its file
 *
 * A policy is named by its file and by nothing else: there is no `name:` field inside one to
 * disagree with it. So the `field_ops_*` keys below are the filenames under
 * `access/policies/`, the generated `PolicyName` union, and what `policiesHeld` matches — one
 * spelling rather than three.
 *
 * An envoy binds the same way, and it binds *here* no longer. `envoys/+field_ops_whatsapp.ts` names
 * its policies directly and carries them, so there is no team behind it. The former transport-only
 * synthetic team existed solely so runtime could rediscover authority already present in the
 * declaration. The entry is gone with that mechanism.
 *
 * ## `Field Operations Controllers` is load-bearing and must not be renamed alone
 *
 * `access/policies/+field_ops_contractor.ts` gates both variation-request mutation branches with
 * `approveBy('Field Operations Controllers')`. The argument is `TeamName`, a union generated from
 * this file's own keys, so renaming the key below without the policy is a compile error. It is
 * plural where the policy's file name is singular, and that mismatch is deliberate and old: one is a
 * body of staff, the other is a capability.
 *
 * ## One team per person, and the collapse it makes visible
 *
 * `user.team_id` is one team, so a combination of authority somebody actually holds has to
 * be a named team. Here that is `Contractor (Controller)` — and it is worth being blunt about what
 * that team is, because it is the case the teams design calls out by name.
 *
 * `field_ops_controller` grants every action on every collection, **unconditionally**. The
 * contractor policy narrows the same coordinates to the requestor. Holding both would state two
 * different rules for one coordinate, so the compiler rejects the overlap instead of merging it.
 *
 * `Contractor (Controller)` used to name both, and therefore meant "everything" while reading as
 * "their own jobs plus dispatch". **The compiler refuses that combination now** — see §3.2: one
 * holder naming an unconditional grant beside a narrowed one on the same collection is a build
 * failure that names both policies. The entry below says what it always meant instead.
 */
export default {
	/**
	 * Dispatch. **Also the `approvers` name in `+field_ops_contractor.ts`** — see above.
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
	 * `user.id`, and holding this policy is what turns that person into somebody
	 * who sees only their own.
	 *
	 * That also settles where a contractor's *company* lives, which is nowhere. A team is authority,
	 * and this file is compiled into the release — a team row absent from it holds nothing — so
	 * modelling one company as one team would mean a deploy to onboard a contractor, and, because
	 * `user.team_id` is one team, would leave that person unable to also be in this one.
	 */
	Contractor: ['field_ops_contractor'],

	/**
	 * Dispatch held by somebody who also works in the field — what two seeded people carry.
	 *
	 * **It names `field_ops_controller` alone, and that is not a narrowing.** `field_ops_controller`
	 * grants every action on every collection `field_ops_contractor` touches, unconditionally, so
	 * naming both changed nothing about what these two people could reach — it only made the file
	 * read as though it did.
	 *
	 * That is exactly what the compiler now refuses: a holder cannot receive two grants for the same
	 * collection/action coordinate. The diagnostic names both policies and the coordinate.
	 *
	 * So the entry says what it always meant. Bob Poh and Yu Kiat Tan hold dispatch; they are between
	 * them the assignee of every seeded assignment, and they read every one of them because dispatch
	 * reads everything. The name keeps the parenthetical because it is still a fact about who these
	 * people are — a contractor who dispatches — even though what they hold is one policy.
	 *
	 * Note what it deliberately is *not*: `Field Operations Controllers`. Approval eligibility follows
	 * the team name, not the policies, so members of this team decide nothing.
	 */
	'Contractor (Controller)': ['field_ops_controller']
} satisfies Teams;
