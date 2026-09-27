import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Design and coordination questions raised during delivery.',
	icon: 'lucide:messages-square',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		rfi_number: { kind: 'text', optional: true, unique: true },
		asked_by: { kind: 'text', optional: true },
		assigned_to: { kind: 'text', optional: true },
		subject: { kind: 'text', optional: true },
		question: { kind: 'text', optional: true },
		answer: { kind: 'text', optional: true },
		status: { kind: 'enum', values: ['open', 'answered', 'closed'], optional: true },
		priority: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		submitted_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		resolved_date: { kind: 'date', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true, optional: true }
	},
	search: { text: ['title'] }
});
