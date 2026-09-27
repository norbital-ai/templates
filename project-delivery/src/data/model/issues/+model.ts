import { model } from '@norbital-ai/bolt';

/** A raised issue on a submitted or in-flight project. */
export default model({
	description: 'An issue raised against a project.',
	icon: 'lucide:circle-alert',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		status: {
			kind: 'enum',
			values: ['open', 'in_progress', 'blocked', 'resolved', 'closed'],
			optional: true
		},
		severity: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		raised_on: { kind: 'instant', optional: true },
		resolved_on: { kind: 'instant', optional: true },
		description: { kind: 'text', optional: true }
	}
});
