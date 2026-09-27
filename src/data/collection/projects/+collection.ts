import { collection } from '@norbital-ai/bolt';

const columns = [
	'project_name',
	'project_number',
	'client',
	'main_contractor',
	'status',
	'schedule_range',
	'currency',
	'contract_value',
	'project_type',
	'address',
	'project_manager',
	'description'
] as const;

export default collection('projects', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
