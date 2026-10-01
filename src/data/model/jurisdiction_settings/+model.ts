import { model } from '@norbital-ai/bolt';

/**
 * A settings lineage versions the family catalogues its companies use. A sealed version and its child catalogues
 * are immutable (each child's transform refuses a write under a seal); a successor clones them into a draft
 * (`new_settings_version`); a wrong seal is voided. Companies bind to a lineage by `code`.
 */
export default model({
	description:
		'One version of a jurisdiction settings lineage: payroll facts and work rules (minimum wages among them), owning its family catalogues and schemes. Holidays belong to the entity that observes them. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
	icon: 'lucide:globe',
	label: 'name',
	fields: {
		/** The lineage: a jurisdiction code, or `<CODE>-<entity>` where an entity forked it. */
		code: { kind: 'text' },
		/** Stable payroll jurisdiction, independent of this catalogue lineage. */
		jurisdiction_code: { kind: 'text' },
		name: { kind: 'text' },
		/** Set once, by the approved seal; never cleared. */
		sealed_at: { kind: 'instant', optional: true },
		/** Set once on a sealed version that must stop governing; never cleared. */
		voided_at: { kind: 'instant', optional: true },
		void_reason: { kind: 'text', optional: true },
		payroll: { kind: 'custom', of: 'payroll_settings' },
		/** The official pages this version was transcribed from; the drift automation reads them. */
		sources: { kind: 'custom', of: 'sources' },
		work_rules: { kind: 'custom', of: 'work_rules' },
		/** The entity facts this version's rules read; `[]` when none (set by the transform). */
		facts: { kind: 'custom', of: 'fact_keys' },
		/** Inputs required to classify and value a departure; `[]` when none (set by the transform). */
		exit_facts: { kind: 'custom', of: 'fact_keys' },
		/** Jurisdiction inputs recorded on dated contract terms (`employment_terms.facts`, `terms.facts.<key>`). */
		terms_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** Jurisdiction inputs recorded on one person-day (`work_days.facts`, `day_facts.<key>`). */
		work_day_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** Jurisdiction inputs recorded with one actual payment (`payment_events.facts`, `payment.facts.<key>`). */
		payment_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** Jurisdiction inputs recorded on the obligation a payment settles (`settlement.facts.<key>`). */
		settlement_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** Inputs recorded on a dated worksite revision (`worksites.facts`, `worksite.facts.<key>`): an industry classification, a project. */
		worksite_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** Jurisdiction inputs recorded on a dated person revision (`person_facts.facts`, `employee.facts.<key>`). */
		person_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** The kinds of prior history a person carries (`employment_history.kind`), each with its declared facts. */
		history_kinds: { kind: 'custom', of: 'history_kinds', default: [] },
		/**
		 * The tables this version's rows fill (`reference_rows`): option lists a `code` input picks from
		 * and statutory tables `table()`, `band()` and `bands()` read.
		 */
		tables: { kind: 'custom', of: 'reference_tables', default: [] },
		/**
		 * Locality overlays (`lineage_overlays`): on a day `when` holds over the placed worksite, the
		 * named lineage's version in force replaces the listed work-rule parts, its leave rows by code and
		 * its tables by name. Schemes stay with this version. `[]` when none.
		 */
		overlays: { kind: 'custom', of: 'lineage_overlays', default: [] },
		/** Employer duties outside the calculation; `[]` when none (set by the transform). */
		obligations: { kind: 'custom', of: 'obligations' },
		/** The employer duties this version declares (the obligation ledger); `[]` when none. */
		duty_types: { kind: 'custom', of: 'duty_types', default: [] },
		/** What refuses or warns at a lifecycle stage (E9); `[]` when none. */
		checks: { kind: 'custom', of: 'checks', default: [] },
		/**
		 * Declared statutory returns and bank files (`returns`): cadence, population, every column as an
		 * expression over the filing site, the record layout and the duty the file evidences. `[]` when none.
		 */
		returns: { kind: 'custom', of: 'returns', default: [] },
		/** What this version changes against its predecessor, in the operator's words. */
		change_summary: { kind: 'text', optional: true },
		effective_range: { kind: 'period', of: 'date' }
	},
	index: ['code', ['code', 'sealed_at']],
	// only sealed, unvoided versions of one lineage are exclusive
	noOverlap: [
		{
			key: ['code'],
			period: 'effective_range',
			where: { sealed_at: { isNull: false }, voided_at: { isNull: true } },
			name: 'jurisdiction_settings_sealed_no_overlap'
		}
	],
	search: { text: ['name'] }
});
