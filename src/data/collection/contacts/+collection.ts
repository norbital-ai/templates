import { collection } from '@norbital-ai/bolt';

const columns = [
	'account_id',
	'first_name',
	'last_name',
	'email',
	'title',
	'department',
	'active'
] as const;

/** A contact belongs to an account on file (the reference refuses any other). */
export default collection('contacts', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
