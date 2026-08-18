import { date, defineModel, enums, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/**
		 * The dispatch system’s reference for this job — the external key the webhook is keyed on.
		 *
		 * Nullable for the same reason `sites.site_code` is: a job somebody files here was never
		 * dispatched and has no reference to carry. The unique index is what makes the inbound binding
		 * idempotent — webhook delivery is at-least-once, so without it a redelivery is a second job.
		 */
		external_ref: text(),
		site_id: uuid().notNull(),
		title: text({ search: true }).notNull(),
		nature: text(),
		scheduled_for: date().notNull(),
		status: enums(['unassigned', 'assigned', 'in_progress', 'completed']),
		description: text().notNull()
	},
	{
		description: 'A site job for a specific day, ready to be dispatched to one contractor.',
		recordLabel: 'title',
		icon: 'lucide:briefcase',
		indexes: [{ columns: ['external_ref'], unique: true }]
	}
);
