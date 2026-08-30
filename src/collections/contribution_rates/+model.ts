import { custom, defineModel, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		statutory_contribution_id: uuid().notNull(),
		selector: custom('rate_selector').notNull(),
		award: custom('rate_award').notNull(),
		/**
		 * The band's own title, composed in SQL.
		 *
		 * `recordLabel` compiles to a CEL concatenation and CEL has no `+` overload for anything but
		 * strings, so naming `selector` resolved to nothing and the record title fell back to joining
		 * every scalar column, which printed `statutory_contribution_id` as a raw uuid. No coercion
		 * turns an object into a title; the band has to say what it is. This mirrors `bandReference`
		 * in `payroll_runs/lib/bands.ts`, which is what a payslip already cites.
		 */
		summary: text({ search: true }).generatedAlwaysAs(
			sql`CASE selector ->> 'by'
				WHEN 'WAGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'WAGE_AND_AGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · age ' || (selector ->> 'age_from') || '–' || COALESCE(selector ->> 'age_to', '∞')
				WHEN 'WAGE_AND_MARITAL' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · ' || LOWER(selector ->> 'marital')
				WHEN 'HEADCOUNT' THEN 'headcount ' || (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'RISK_CLASS' THEN 'risk ' || (selector ->> 'class')
				ELSE 'band'
			END`
		)
	},
	{
		description:
			'One band of one statutory contribution: the selector that picks it (wage, wage and age, headcount or risk class) and the award it pays. A floor is the first band, a ceiling the terminal one. Scoped to the profile through its scheme and sealed with it.',
		recordLabel: 'summary',
		icon: 'lucide:percent',
		// Per-profile versioning replaces effective dating: successive bands coexist because their
		// selectors do not overlap; only a pair overlapping in the band within one scheme is a
		// duplicate. The selector is a variant, so the band is projected out of the JSONB. `::numeric`
		// is IMMUTABLE (`numeric_in` is `provolatile = 'i'`), unlike `::date`, so it is legal here.
		//
		// The band is the pair of ranges the selector actually keys on. Discriminator and risk class
		// are equality members because a WAGE row and a RISK_CLASS row are never the same cell; the
		// age range is its own dimension because EPF/SOCSO/EIS all carry an `age_from 60` row over the
		// SAME wage bands. The marital category is an equality member for the same reason.
		exclusions: [
			{
				name: 'contribution_rates_no_overlap',
				elements: [
					{ expr: 'statutory_contribution_id', with: '=' },
					{ expr: "(selector->>'by')", with: '=' },
					{ expr: "COALESCE(selector->>'class', '')", with: '=' },
					{ expr: "COALESCE(selector->>'marital', '')", with: '=' },
					{
						expr: "numrange((selector->>'from')::numeric, (selector->>'to')::numeric, '[)')",
						with: '&&'
					},
					{
						expr: "numrange((selector->>'age_from')::numeric, (selector->>'age_to')::numeric, '[)')",
						with: '&&'
					}
				]
			}
		]
	}
);
