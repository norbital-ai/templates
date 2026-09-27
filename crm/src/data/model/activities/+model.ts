import { model } from '@norbital-ai/bolt';

/** Linked to exactly one of an account or a quote (`regarding`, an exclusive arc). */
export default model({
	description:
		'Sales activities — calls, meetings, emails, tasks, and notes — linked to an account or deal.',
	icon: 'lucide:calendar-check',
	label: 'subject',
	fields: {
		type: { kind: 'enum', values: ['call', 'meeting', 'email', 'task', 'note'], optional: true },
		subject: { kind: 'text' },
		description: { kind: 'text', optional: true },
		due_date: { kind: 'date', optional: true },
		completed_at: { kind: 'instant', optional: true }
	},
	index: ['due_date'],
	search: { text: ['subject'] }
});
