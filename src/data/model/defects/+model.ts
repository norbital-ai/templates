import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Quality issues and closeout items tracked in project context.',
	icon: 'lucide:triangle-alert',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		defect_number: { kind: 'text', optional: true, unique: true },
		reported_by: { kind: 'text', optional: true },
		assigned_to: { kind: 'text', optional: true },
		category: { kind: 'text', optional: true },
		severity: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		status: {
			kind: 'enum',
			values: ['open', 'in_review', 'ready_for_closeout', 'closed'],
			optional: true
		},
		description: { kind: 'text', optional: true },
		reported_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		closed_date: { kind: 'date', optional: true },
		photos: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png'],
			max: '20MiB',
			multiple: true,
			optional: true
		},
		resolution_notes: { kind: 'text', optional: true }
	},
	search: { text: ['title'] }
});
