import { custom, defineModel, enums, integer, sql, text } from '@norbital-ai/bolt/authoring';

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
		 * How often the entity pays. `SEMI_MONTHLY` is half on the 15th and half at the period end,
		 * for the employments whose terms say so, while the entity's monthly employments stay on the
		 * cutoff window; `WEEKLY` pays each Monday-to-Sunday week on its Sunday (`YYYY-MM-n`, the
		 * n-th week whose Sunday falls in the month) and its monthly employments in the last week.
		 * Every period pays on its last day; the compliance month is the cutoff month.
		 */
		pay_frequency: enums(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY']).notNull().default('MONTHLY'),
		/**
		 * Where a `SEMI_MONTHLY` entity deducts the schemes its law assesses over the MONTH (SSS,
		 * PhilHealth, Pag-IBIG). The premium is monthly on the month's compensation; the law leaves
		 * the timing across cut-offs to the employer. `FIRST` takes the whole month on the mid-month
		 * cut-off, `LAST` on the end-month one, `SPLIT` divides the monthly contribution and reconciles
		 * the closing cut-off to actual monthly wages. Per-period schemes keep their own cadence.
		 */
		semi_monthly_statutory_cutoff: enums(['FIRST', 'SPLIT', 'LAST']).notNull().default('FIRST'),
		/**
		 * The occupational risk group the entity is rated in, where its regime prices a contribution
		 * by risk rather than by wage or age. Indonesia's JKK is published as a risk ladder
		 * (a rule whose `when` reads `risk_class`), so `selectRule` filters the JKK rules on this column; a null risk
		 * class in such a jurisdiction matches no rule and the run stops naming JKK. Entities whose
		 * jurisdiction has no risk-keyed scheme leave it empty, and the form does not show it.
		 */
		risk_class: text(),
		/**
		 * The region the entity sits in, as `jurisdiction_settings.work_rules.wages.by_region` names it. A scheme's
		 * `FLOOR:MINIMUM_WAGE` / `CAP:MINIMUM_WAGE_X:<n>` rule reads that wage; predicates read
		 * `company.region`. Empty where the jurisdiction states no regional wage.
		 */
		region: text(),
		/**
		 * The entity's recorded facts, keyed by the names its settings version declares: sector,
		 * overtime consent, establishment tests. A rule reads one as `person.company.facts.<key>`.
		 * The governing version validates required values and constraints before applying defaults.
		 */
		facts: custom('entity_facts')
			.notNull()
			.default(sql`'{}'::jsonb`),
		/**
		 * The Google holiday calendar this entity's annual holiday drafts are read from.
		 *
		 * Operational, not law, and the entity's rather than the jurisdiction's: two entities in one
		 * country keep different calendars, so the source that fills them cannot be one per country.
		 * The annual import iterates entities and reads this.
		 */
		holiday_source: custom('holiday_source'),
		/**
		 * Which payroll workbook this entity hands out, by name.
		 *
		 * `MATRIX` is the catalogue-driven sheet every export carries: one column per catalogue
		 * component, labelled by its code, grouped by category in catalogue order. `VENDOR` adds the
		 * customer's own salary listing beside it, in that file's settled column vocabulary.
		 *
		 * Named rather than inferred. The listing used to appear whenever every payslip in a period
		 * happened to be in MYR, so one employer's Malaysian entity and its Singaporean one received
		 * differently shaped files and neither could say otherwise.
		 */
		workbook_layout: enums(['MATRIX', 'VENDOR']).notNull().default('MATRIX'),
		/**
		 * The account this entity pays salaries from, as the originator of a bank file.
		 *
		 * The employee's destination lives on the employment; this is the other side — the payer a
		 * bank file's header names. `bank_code` here is the originator's BIC (`OCBCSGSGXXX`), not the
		 * numeric bank code an employee row may carry. Empty where the entity hands out no bank file.
		 */
		disbursement_account: custom('bank_account'),
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
