import { collection } from '@norbital-ai/bolt';

const columns = [
	'title',
	'rfi_number',
	'project_id',
	'asked_by',
	'assigned_to',
	'subject',
	'question',
	'answer',
	'status',
	'priority',
	'submitted_date',
	'due_date',
	'resolved_date',
	'attachments',
	'related_defect_id'
] as const;

export default collection('rfis', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
