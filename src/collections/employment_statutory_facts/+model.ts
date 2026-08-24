import { custom, defineModel, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		statutory_contribution_id: uuid().notNull(),
		/**
		 * The predecessor this row closes when it is submitted as an automated successor.
		 *
		 * Ordinary people-policy field masks exclude it. The statutory-successor static identity is the
		 * only non-administrator that may supply it, and the create hook validates and stages the linked
		 * predecessor update into the same reviewed graph.
		 */
		supersedes_fact_id: uuid(),
		status: custom('statutory_fact_status').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/**
		 * The fact's own title, composed in SQL.
		 *
		 * `recordLabel` compiles to a CEL concatenation and CEL has no `+` overload for anything but
		 * strings, so naming `status` and `effective_range` — a variant and a range, both objects —
		 * resolved to nothing and the record title fell back to joining every scalar column, which
		 * printed `employment_id` and `statutory_contribution_id` as raw uuids. No coercion turns an
		 * object into a title.
		 */
		summary: text({ search: true }).generatedAlwaysAs(
			sql`CASE status ->> 'kind'
				WHEN 'REGISTERED' THEN 'Registered · ' || COALESCE(NULLIF(status ->> 'reference_number', ''), 'no reference')
				WHEN 'NOT_REGISTERED' THEN 'Not registered · ' || COALESCE(NULLIF(status ->> 'reason', ''), 'no reason given')
				ELSE 'Statutory fact'
			END || ' · from ' || LEFT(effective_range ->> 'start', 10)`
		)
	},
	{
		description:
			'Where one employment stands with one statutory scheme — registered with a reference number, or not registered with a reason. An absent row means registered with nothing captured.',
		recordLabel: 'summary',
		icon: 'lucide:badge-check',
		// Plan 02 §7: employment =, contribution =, effective range &&.
		exclusions: [
			{
				name: 'employment_statutory_facts_no_overlap',
				elements: [
					{ expr: 'employment_id', with: '=' },
					{ expr: 'statutory_contribution_id', with: '=' },
					{ expr: 'bolt_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
