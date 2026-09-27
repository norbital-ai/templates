import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'title',
	'status',
	'severity',
	'raised_on',
	'resolved_on',
	'project_id',
	'owner_id',
	'description'
] as const;

export default collection('issues', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
