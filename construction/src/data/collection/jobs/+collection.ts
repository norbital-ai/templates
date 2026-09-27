import { collection } from '@norbital-ai/bolt';

const columns = [
	'job_title',
	'job_number',
	'project_id',
	'job_type',
	'status',
	'schedule_range',
	'currency',
	'budget',
	'bim_reference_id',
	'site_location_id',
	'description',
	'priority'
] as const;

export default collection('jobs', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
