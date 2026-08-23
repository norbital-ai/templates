import type { Teams } from '@norbital-ai/bolt/authoring';

/**
 * ============================================================================
 * WHICH POLICIES EACH TEAM HOLDS
 * ============================================================================
 *
 * `src/access/policies/` says what each policy grants; this file says who holds it. A `team` row is
 * membership — a name, a parent, a description, edited from the dashboard — and this map is
 * authority, compiled into the release. The two are bound by **name**, case-insensitively; a team
 * row this file does not name holds no policies at all.
 *
 * ## The values are policy names, and a policy is named by its file
 *
 * The three policies are named for their files — `construction_project_workspace`,
 * `construction_settings_reference_matrix` and `construction_settings_workforce` — and
 * `policiesHeldByTeam` resolves a team's policies against that `name`. `Teams` narrows the strings
 * below to the generated `PolicyName` union, so a name no file declares fails the build.
 *
 * They deliberately do not read as the `Construction …` titles the three apps carry. An app title is
 * copy and can be reworded; a policy name is a binding, and the two drifting apart is what left
 * these entries naming policies that did not answer.
 *
 * ## What actually separates the three policies is `apps`, and that is what makes teams useful here
 *
 * All three policies grant the *same twelve reads* and no writes anywhere — the sibling policy files
 * say at length why that repetition is deliberate rather than an oversight to tidy. They differ in
 * exactly one thing: which application they open. So a team in this workspace is a statement about
 * which surface somebody works in, not about which rows they can reach, and the four entries below
 * are the four combinations of surfaces that make sense.
 *
 * A consequence worth stating plainly: composing these by `parent_id` inheritance would buy nothing,
 * because there is no narrowing to preserve. Every grant is unconditional, so the union of any two
 * of these policies is the same twelve reads with two apps instead of one.
 *
 * ## One team per person
 *
 * Everybody seeded into this workspace today works across all three surfaces, so they are all in
 * `Construction Administrators`. The three single-surface teams below are empty and are declared
 * anyway: the reason there are three policies rather than one is that the surfaces are separable,
 * and discovering the separation only when somebody first needs it is worse than declaring it now.
 *
 * No grant here carries an `approval`, so no key below is also an `approvers` entry.
 */
export default {
	/** Delivery: projects, jobs, RFIs, defects, permits and payment claims, through one app. */
	'Project Delivery': ['construction_project_workspace'],

	/** The BIM reference matrix settings surface. Reads the projects and assets that cite the matrix. */
	'Reference Matrix Administrators': ['construction_settings_reference_matrix'],

	/** The workforce settings surface: the worker library and certification compliance. */
	'Workforce Administrators': ['construction_settings_workforce'],

	/**
	 * All three surfaces at once — the delivery app and both settings apps.
	 *
	 * The whole set is listed rather than a pointer at the teams above, matching hr-payroll's
	 * convention: `rowPredicate` unions the `where` of every matching grant, so what a team confers
	 * is the union of its policies whatever order they appear in, and a list that reads top to bottom
	 * is worth more than a derivation to run in your head.
	 *
	 * This is the team every seeded person is in, and it is what their three `roles` entries meant
	 * before roles were deleted.
	 */
	'Construction Administrators': [
		'construction_project_workspace',
		'construction_settings_reference_matrix',
		'construction_settings_workforce'
	]
} satisfies Teams;
