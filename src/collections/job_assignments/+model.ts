import {
	boolean,
	defineModel,
	enums,
	geolocation,
	custom,
	text,
	timestamp,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_id: uuid().notNull(),
		contractor_profile_id: uuid().notNull(),
		dispatched_at: timestamp(),
		status: enums(['dispatched', 'in_progress', 'completed', 'suspect']),
		completed_at: timestamp(),
		amount_charged: custom('money'),
		location: geolocation(),
		summary: text({ search: true }),
		source_message_id: text(),
		/** Fail closed until a linked photo visibly establishes a site identifier. */
		site_identity_unverified: boolean().notNull().default(true),
		/** One-way integrity finding: a photographed identifier contradicts the assigned site. */
		site_identity_mismatch: boolean().notNull().default(false),
		site_identity_evidence_id: uuid(),
		extracted_site_name: text(),
		extracted_site_location: text(),
		extracted_unit_number: text(),
		site_identity_confidence: enums(['low', 'medium', 'high']),
		site_identity_checked_at: timestamp(),
		site_identity_rationale: text()
	},
	{
		description:
			'Contractor assigned to a site job. Tracks dispatch, on-site progression, and photo evidence.',
		recordLabel: 'summary',
		icon: 'lucide:clipboard-check',
		indexes: [
			{ columns: ['source_message_id'], unique: true },
			{ columns: ['job_id'], unique: true },
			{ columns: ['contractor_profile_id'] }
		]
	}
);
