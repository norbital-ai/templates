import {
	custom,
	defineModel,
	enums,
	integer,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One statutory profile: a versioned configuration set whose seal makes it the single source a
 * payroll run is made of. The law members (regime, statutory leave floors) and the catalogue rows
 * scoped to it — leave types, pay components, schemes, rates — are all resolved through this row,
 * and sealing freezes every one of them.
 *
 * ## Lifecycle
 *
 * ```text
 * DRAFT ──approval (HR Manager)──► SEALED ──void──► VOIDED
 *  editable                        frozen           frozen, not pickable, keeps citations
 *  not pickable                    pickable
 * ```
 *
 * A DRAFT profile is prepared by the HR controller or staged by the drift automation; sealing is
 * the HR Manager approval. VOIDED profiles stay on the record and keep the runs that cite them —
 * traceability — while a successor draft governs going forward.
 *
 * `effective_range` is the period this version governs; versions of one law family share `code`
 * and are end-dated when superseded. Per-row effective dating inside the catalogues is gone —
 * this member does that job for everything scoped to it.
 *
 * The `statutory_leave` member's canonical kinds are the same literals
 * `datatypes/statutory_leave_profile` declares; the leave-types hook validates a row's kind
 * against the linked profile's member, which is what pins the two vocabularies together.
 */
export default defineModel(
	{
		code: text().notNull(),
		name: text({ search: true }).notNull(),
		lifecycle: enums(['DRAFT', 'SEALED', 'VOIDED']).notNull().default('DRAFT'),
		currency: text().notNull(),
		tax_year_start_month: integer().notNull(),
		proration: custom('proration_basis').notNull(),
		ordinary_rate_basis: enums(['DAYS_PER_MONTH', 'HOURS_PER_MONTH']).notNull(),
		ordinary_rate_divisor: numeric().notNull(),
		regime: custom('statutory_regime').notNull(),
		statutory_leave: custom('statutory_leave_profile').notNull(),
		/** A successor takes over only after approval, from its effective start; the predecessor stays historical. */
		supersedes_id: uuid(),
		revision: custom('statutory_revision'),
		research_urls: text().array(),
		/** Set when VOIDED: the profile the void enacted for this period. */
		successor_profile_id: uuid(),
		/** Set when VOIDED: why the profile was retired. */
		void_reason: text(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'One versioned statutory profile — currency, year boundaries, proration, ordinary-rate basis, the atomic overtime regime, and the statutory leave floors — that scopes and seals the leave, component and scheme catalogues a payroll run is made of.',
		recordLabel: 'name',
		icon: 'lucide:globe',
		indexes: [
			{ columns: ['code'] },
			{ columns: ['lifecycle'] },
			{ columns: ['supersedes_id'], unique: true, where: '"supersedes_id" IS NOT NULL' }
		]
	}
);
