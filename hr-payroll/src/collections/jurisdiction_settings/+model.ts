import { custom, defineModel, instant, integer, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A settings lineage versions the family catalogues used by its companies. The settings root
 * identifies currency, tax year and effective dates; Work owns salary and working-time rules.
 * Holidays belong to the employing entity, not to this lineage.
 *
 * A sealed version and its child catalogues are immutable. A successor clones them into a draft.
 * Companies select a lineage by code, and sealed, unvoided versions of that code cannot overlap.
 */
export default defineModel(
	{
		/** The lineage: a jurisdiction code, or `<CODE>-<entity>` where an entity forked it. */
		code: text().notNull(),
		/** Stable payroll jurisdiction, independent of this catalogue lineage. */
		jurisdiction_code: text().notNull(),
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

		/**
		 * The official pages this version was transcribed from. The statutory drift automation reads
		 * them monthly for the version in force and proposes a draft when a statutory row differs.
		 */
		research_urls: text().array(),
		/** Set by the statutory drift automation on the draft it proposes; the review sheet. */
		research_notes: custom('statutory_proposal'),
		/**
		 * What this version changes against its predecessor, in the operator's words: the instrument
		 * that moved and the value it moved. Prose for the snapshot beside its sources; the engine
		 * never reads it.
		 */
		change_summary: text(),
		/** Region → monthly minimum wage, in the version's currency; read by `companies.region`. */
		minimum_wages: custom('minimum_wages'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'One version of a jurisdiction settings lineage: currency, tax year and effective period, owning its family catalogues and schemes,. Holidays belong to the entity that observes them. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
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
