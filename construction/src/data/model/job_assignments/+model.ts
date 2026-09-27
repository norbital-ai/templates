import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Worker assignments tied to project jobs and site locations.',
	icon: 'lucide:hard-hat',
	label: 'assignment_code',
	fields: {
		assignment_code: { kind: 'text', optional: true },
		role: { kind: 'text', optional: true },
		assignment_range: { kind: 'period', of: 'date', optional: true },
		status: {
			kind: 'enum',
			values: ['assigned', 'in_progress', 'completed', 'cancelled'],
			optional: true
		},
		hours_per_day: { kind: 'decimal', scale: 2, optional: true },
		required_certifications: { kind: 'text', many: true, optional: true }
	},
	search: { text: ['assignment_code'] }
});
