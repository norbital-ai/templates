import { custom, defineModel, enums, integer, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/**
		 * The jurisdiction settings lineage the entity operates under: a code such as `MY` or `SG`,
		 * or `SG-norbital` where this entity forked the shared law with its own catalogue. The
		 * version in force on a date is picked from the lineage, so two entities can take one
		 * settings root and a change of law never touches the company row.
		 */
		settings_code: text().notNull(),
		name: text({ search: true }).notNull(),
		/**
		 * Nullable: an entity whose source never supplied a number carries `null`, never a sentinel. The
		 * seed loader maps the bank's literal `SOURCE_NOT_PROVIDED` to `null`, and the entity picker shows
		 * no subtitle for it.
		 */
		registration_number: text(),
		/** The day a run's attendance window opens; the window closes the day before it next month. */
		pay_cutoff_day: integer().notNull(),
		/**
		 * How often the entity pays. `SEMI_MONTHLY` is the only cadence beside monthly any seed uses:
		 * half on the 15th and half at the period end, for the employments whose terms say so, while
		 * the entity's monthly employments stay on the cutoff window. Both pay on the period end; the
		 * compliance month is the cutoff month.
		 */
		pay_frequency: enums(['MONTHLY', 'SEMI_MONTHLY']).notNull().default('MONTHLY'),
		/**
		 * The occupational risk group the entity is rated in, where its regime prices a contribution
		 * by risk rather than by wage or age. Indonesia's JKK is published as a risk ladder
		 * (`RISK_CLASS` selector), so `selectBand` filters the JKK bands on this column; a null risk
		 * class in such a jurisdiction matches no band and the run stops naming JKK. Entities whose
		 * jurisdiction has no risk-keyed scheme leave it empty, and the form does not show it.
		 */
		risk_class: text(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'An employing entity bound to one jurisdiction settings lineage: its attendance cutoff, pay frequency and risk class. Headcount is derived from active employments, never stored.',
		recordLabel: 'name',
		icon: 'lucide:building-2',
		indexes: [{ columns: ['settings_code'] }]
	}
);
