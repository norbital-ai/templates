import { collection } from '@norbital-ai/bolt';

const columns = [
	'external_code',
	'name',
	'industry',
	'website',
	'phone',
	'currency',
	'address',
	'credit_limit',
	'credit_used',
	'credit_hold',
	'active'
] as const;

/** The customer master: the form and the ERP import pipeline write it as is. */
export default collection('accounts', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
