import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'subject',
	'kind',
	'happened_on',
	'project_id',
	'contact_id',
	'detail',
	'recording'
] as const;

export default collection('activities', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
