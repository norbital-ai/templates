import { collection } from '@norbital-ai/bolt';

const columns = [
	'title',
	'defect_number',
	'project_id',
	'site_location_id',
	'job_id',
	'reported_by',
	'assigned_to',
	'category',
	'severity',
	'status',
	'description',
	'reported_date',
	'due_date',
	'closed_date',
	'photos',
	'resolution_notes'
] as const;

export default collection('defects', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
