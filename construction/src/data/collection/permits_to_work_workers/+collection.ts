import { collection } from '@norbital-ai/bolt';

const columns = ['permits_to_work_id', 'worker_id'] as const;

export default collection('permits_to_work_workers', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
