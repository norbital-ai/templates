import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'scope',
	'family',
	'code',
	'name',
	'content_hash',
	'source_identity',
	'rules',
	'settings_id'
] as const;
const update_columns = [
	'scope',
	'family',
	'code',
	'name',
	'content_hash',
	'source_identity',
	'rules'
] as const;

export default collection('rule_set', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
