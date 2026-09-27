import { collection } from '@norbital-ai/bolt';

const columns = ['job_id', 'certification_type_id'] as const;

export default collection('jobs_certification_types', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
