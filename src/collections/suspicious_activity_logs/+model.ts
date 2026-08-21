import { defineModel, text, timestamp, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_assignment_id: uuid().notNull(),
		/** What the system or a controller saw. Written when the suspicion is raised, never edited. */
		reason: text({ search: true }).notNull(),
		/**
		 * What a controller concluded, and the only thing that closes a log.
		 *
		 * Null while open. A log is not a flag to be cleared — somebody has to say whether the
		 * suspicion was correct, and that sentence is the record. Clearing it silently would leave the
		 * next reader unable to tell "looked at and fine" from "nobody has looked".
		 */
		resolution: text({ search: true }),
		resolved_at: timestamp(),
		resolved_by: uuid()
	},
	{
		description:
			'A suspicion raised against one job assignment, and what a controller concluded about it. Visible to controllers only.',
		recordLabel: 'reason',
		icon: 'lucide:shield-alert',
		indexes: [{ columns: ['job_assignment_id'] }, { columns: ['resolved_at'] }]
	}
);
