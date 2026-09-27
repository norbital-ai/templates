import { collection } from '@norbital-ai/bolt';

const columns = [
	'certification_name',
	'certification_code',
	'category',
	'issuing_body',
	'validity_period_months',
	'requires_refresher',
	'description',
	'requirements'
] as const;

export default collection('certification_types', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
