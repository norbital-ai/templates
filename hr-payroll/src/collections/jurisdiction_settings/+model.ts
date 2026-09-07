import { custom, defineModel, instant, integer, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * Jurisdiction settings: the one sealed, shareable root every payroll, leave and scheduling rule
 * of an entity hangs off. A version carries the payroll scalars itself (currency, tax year,
 * proration, the rate-of-pay divisor, the working-time regime) and owns every downstream row:
 * `statutory_contributions` with their `contribution_rates`, `leave_catalogue`, `component_catalogue` and
 * `company_holidays`, each flagged `is_statutory` where the law names it and company rule where
 * the entity does. Shift definitions stay per company: they are site operations, not rules.
 *
 * ## Lineages and versions
 *
 * Versions of one lineage share `code`: `MY`, `SG`, or `SG-norbital` where an entity forked the
 * shared law with its own catalogue. A company binds to a lineage through
 * `companies.settings_code`, so two entities can take one settings root, and a change of law is a
 * new version of the same code with a later `effective_range` (`functions/+new_settings_version`
 * clones the root and every child into a draft). The version in force on a date is the sealed,
 * unvoided one whose range covers it, read half-open (`[start, end)`).
 *
 * ## Sealing, immutability, void
 *
 * A draft (`sealed_at` null) is the HR controller's to prepare, children included. Sealing is the
 * HR Manager's act and freezes the version and all of its children: every child hook refuses
 * create, update and delete once the root is sealed, and the root's own hook refuses every column
 * change except `voided_at` and `void_reason`. A sealed version is never unsealed; a wrong seal is
 * voided (one action, with a reason when a paid payroll run cites it) and a corrected version is
 * sealed in its place. Two sealed unvoided versions of one code cannot overlap: the
 * `jurisdiction_settings_sealed_no_overlap` exclusion holds it in the database and the hook says
 * it in a sentence first. Sealing a successor ends its predecessor's range the day before.
 *
 * ## Statutory drift
 *
 * `research_urls` names the official pages a version transcribes. The `statutory_drift`
 * automation reads them for the version in force, extracts what the statutory rows should say,
 * and when a row differs clones the version into a draft carrying the changed rows and a
 * `research_notes` review sheet. It never seals and never touches a sealed row.
 */
export default defineModel(
	{
		/** The lineage: a jurisdiction code, or `<CODE>-<entity>` where an entity forked it. */
		code: text().notNull(),
		name: text({ search: true }).notNull(),
		/** Set once, by the HR Manager's approval; never cleared. */
		sealed_at: instant(),
		/** Set once on a sealed version that must stop governing; never cleared. */
		voided_at: instant(),
		void_reason: text(),
		/** The version this one was cloned from, for the timeline; no edge, so a predecessor may go. */
		cloned_from_id: uuid(),
		currency: text().notNull(),
		tax_year_start_month: integer().notNull(),
		/** Partial month: divide by calendar days, working days or a fixed number of days. */
		proration: custom('proration_basis').notNull(),
		/** Rate of pay: monthly wage ÷ divisor, per day or per hour. */
		ordinary_rate: custom('ordinary_rate').notNull(),
		regime: custom('statutory_regime').notNull(),
		/**
		 * The official pages this version was transcribed from. The statutory drift automation reads
		 * them monthly for the version in force and proposes a draft when a statutory row differs.
		 */
		research_urls: text().array(),
		/** Set by the statutory drift automation on the draft it proposes; the review sheet. */
		research_notes: custom('statutory_proposal'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'One version of a jurisdiction settings lineage: currency, tax year, effective period, proration, the rate-of-pay divisor and the atomic overtime regime, owning its schemes, rate bands, leave catalogue entries, components and holidays. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
		recordLabel: 'name',
		icon: 'lucide:globe',
		indexes: [{ columns: ['code'] }, { columns: ['code', 'sealed_at'] }],
		// Only sealed, unvoided rows take part: the CASE is NULL on a draft or a voided version, and
		// an exclusion never conflicts on NULL, which is the `WHERE` the constraint grammar has no
		// clause for.
		exclusions: [
			{
				name: 'jurisdiction_settings_sealed_no_overlap',
				elements: [
					{
						expr: '(CASE WHEN sealed_at IS NOT NULL AND voided_at IS NULL THEN code END)',
						with: '='
					},
					{ expr: 'bolt_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
