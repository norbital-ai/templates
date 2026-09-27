import { collection } from '@norbital-ai/bolt';

const columns = [
	'permit_number',
	'permit_type',
	'project_id',
	'site_location_id',
	'job_id',
	'worker_id',
	'status',
	'requested_date',
	'validity_range',
	'approved_by',
	'hazards_identified',
	'control_measures',
	'signatures'
] as const;

export default collection('permits_to_work', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
