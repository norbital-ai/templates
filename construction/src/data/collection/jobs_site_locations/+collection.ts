import { collection } from '@norbital-ai/bolt';

const columns = ['job_id', 'site_location_id'] as const;

export default collection('jobs_site_locations', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
