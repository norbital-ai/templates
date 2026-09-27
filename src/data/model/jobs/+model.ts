import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Project work packages configured by site location and BIM reference context.',
	icon: 'lucide:briefcase-business',
	label: 'job_title',
	fields: {
		job_title: { kind: 'text' },
		job_number: { kind: 'text', optional: true, unique: true },
		job_type: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['planned', 'ready', 'in_progress', 'completed', 'blocked', 'cancelled'],
			optional: true
		},
		schedule_range: { kind: 'period', of: 'date', optional: true },
		currency: { kind: 'currency', optional: true },
		budget: { kind: 'money', currency: 'currency', optional: true },
		description: { kind: 'text', optional: true },
		priority: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true }
	},
	search: { text: ['job_title'] }
});
