import { defineModel, enums, instant, integer, jsonb, text } from '@norbital-ai/bolt/authoring';

type LocalFinding = Readonly<{ kind: string; label: string }>;
type OfficialSource = Readonly<{
	title: string;
	url: string;
	jurisdiction_code: string;
	finding: string;
}>;
type ChangeToReview = Readonly<{
	jurisdiction_code: string;
	subject: string;
	current_local_value: string;
	latest_official_value: string;
	rationale: string;
	source_url: string;
}>;

export default defineModel(
	{
		status: enums(['RUNNING', 'SUCCEEDED', 'FAILED']).notNull(),
		checked_at: instant().notNull(),
		completed_at: instant(),
		local_findings_count: integer().notNull(),
		local_findings: jsonb().$type<ReadonlyArray<LocalFinding>>().notNull(),
		successor_proposals_count: integer().notNull(),
		successor_proposals: jsonb().$type<ReadonlyArray<string>>().notNull(),
		web_summary: text({ search: true }),
		web_highlights: jsonb().$type<ReadonlyArray<string>>(),
		official_sources: jsonb().$type<ReadonlyArray<OfficialSource>>(),
		changes_to_review: jsonb().$type<ReadonlyArray<ChangeToReview>>(),
		error: text({ search: true })
	},
	{
		description:
			'Immutable evidence for one statutory-profile drift run: deterministic local findings and successor approval proposals, plus the model’s official-source research. A suggested web change is review material and never edits statutory configuration by itself.',
		recordLabel: ['checked_at', 'status'],
		icon: 'lucide:scan-search',
		indexes: [{ columns: ['checked_at'] }, { columns: ['status'] }]
	}
);
