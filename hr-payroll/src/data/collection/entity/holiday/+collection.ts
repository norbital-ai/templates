import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'company_id'
] as const;
const update_columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'company_id'
] as const;

export default collection('holiday', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
