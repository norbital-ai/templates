import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'name',
	'status',
	'industry',
	'region',
	'website',
	'nda_required',
	'nda_signed_on',
	'nda_document',
	'notes'
] as const;

export default collection('companies', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
