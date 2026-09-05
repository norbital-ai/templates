import { boolean, defineModel, instant, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_code: text().notNull(),
		title: text({ search: true }).notNull(),
		url: text().notNull(),
		rationale: text().notNull(),
		active: boolean().notNull().default(true),
		discovered_from: text(),
		excerpt: text(),
		source_sha256: text(),
		retrieved_at: instant()
	},
	{
		description:
			'HR-approved research entry pages. Approval permits this HTTPS origin only for the named jurisdiction; pending proposals never expand the research allowlist.',
		recordLabel: 'title',
		icon: 'lucide:shield-check',
		indexes: [{ columns: ['jurisdiction_code', 'url'], unique: true }]
	}
);
