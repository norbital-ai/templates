import type { Teams } from '@norbital-ai/bolt/authoring';

/**
 * ============================================================================
 * WHICH POLICIES EACH TEAM HOLDS
 * ============================================================================
 *
 * `src/access/policies/` says what each policy grants; this file says who holds it. Between them they are
 * the whole of authority in this workspace — there is no third place, and in particular no database
 * row that confers a policy.
 *
 * ## Membership is a row, authority is a diff
 *
 * A `team` row carries a name, a parent and a description, and an operator moves somebody
 * between teams from the dashboard without a deploy. What a team may *do* is this file, compiled
 * into the release. The two are bound by **name**, matched case-insensitively; a team row whose name
 * is absent here holds nothing — inert, not broken.
 *
 * ## The values are policy names, and a policy is named by its file
 *
 * `access/policies/+sales_rep.ts` *is* `sales_rep` — the same rule a collection, an app and an
 * envoy are named by, and there is no `name:` field inside the file to disagree with it. `Teams`
 * narrows the strings below to the generated `PolicyName` union, so a name no file declares is a
 * build error here rather than an authority that is silently empty at run time.
 *
 * These entries used to read `Sales representative` and `Procurement officer`, because that is what
 * the two policies declared inside themselves. Nothing matched them: the union is built from the
 * filenames, which is why the restated field is gone.
 *
 * ## The buy/sell boundary, and why it survives being written down
 *
 * The two policies are deliberately disjoint rather than a ladder: procurement has no `quotes`
 * grant, so it never sees a sell price or a margin, and sales has no `purchase_order_lines` grant,
 * so it never sees a buy cost. `products` is the one shared surface, and it carries sell prices
 * only. Nothing here inherits from anything, because neither side is the other's senior.
 *
 * ## One team per person
 *
 * `user.team_id` is one team, so somebody who needs both sides of the desk needs a team
 * that names both — `Sales & Procurement` below. That is the combination the seeded administrators
 * actually hold, and stating it here is what makes "this person sees cost *and* margin" a fact a
 * reviewer can see rather than an emergent property of two arrays.
 *
 * No grant in this workspace carries an `approval`, so no team name here is also an `approvers`
 * entry. If one is ever added, the step's `approvers` string and a key below have to be the same
 * string, or the approval is undecidable.
 */
export default {
	/** The sell side: own quotes, invoices and signings, plus the shared account and product book. */
	Sales: ['sales_rep'],

	/** The buy side: suppliers, purchase orders, receipts and purchase invoices. Never the pipeline. */
	Procurement: ['procurement_officer'],

	/**
	 * Both sides of the desk.
	 *
	 * `&` rather than hr-payroll's `Base (Extra)` parenthetical, because neither policy is a rank
	 * above the other — this is a union of two peers, not an escalation of one. It is what the three
	 * seeded administrators hold today, and it is the only team in this workspace that can see a buy
	 * cost and a sell margin at the same time.
	 */
	'Sales & Procurement': ['sales_rep', 'procurement_officer']
} satisfies Teams;
