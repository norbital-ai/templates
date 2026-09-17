import { custom, defineModel, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		statutory_contribution_id: uuid().notNull(),
		/**
		 * The predecessor a successor row names. Nothing writes it today: no form or grant offers
		 * it, and a successor closes its predecessor by an explicit edit of the predecessor's range.
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
			'Where one person stands with one statutory scheme — registered with a reference number, or not registered with a reason. An absent row means registered with nothing captured.',
		recordLabel: 'summary',
		icon: 'lucide:badge-check',
		// Exclusion: employee =, contribution =, effective range && — the same **inclusive**
		// `[]` reading the engine's `coversDate` applies to a fact, and the same conversion
		// `employment_terms` makes beside it. A raw `bolt_daterange` is half-open, which would let
		// a successor begin on its predecessor's last day and leave two standings on that day.
		exclusions: [
			{
				name: 'employment_statutory_facts_no_overlap',
				elements: [
					{ expr: 'employee_id', with: '=' },
					{ expr: 'statutory_contribution_id', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(effective_range - 'end')), upper(bolt_daterange(effective_range - 'start')), '[]')",
						with: '&&'
					}
				]
			}
		]
	}
);
