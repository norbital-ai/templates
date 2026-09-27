import { collection } from '@norbital-ai/bolt';

const columns = ['permits_to_work_id', 'certification_type_id'] as const;

export default collection('permits_to_work_certification_types', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
