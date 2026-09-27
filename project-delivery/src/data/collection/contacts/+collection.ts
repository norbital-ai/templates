import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'full_name',
	'job_title',
	'email',
	'phone',
	'company_id',
	'is_primary',
	'notes'
] as const;

export default collection('contacts', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
