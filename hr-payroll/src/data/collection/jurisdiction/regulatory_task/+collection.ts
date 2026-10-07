import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'title',
	'authority',
	'subject_collection',
	'subject_id',
	'trigger_ref',
	'triggered_on',
	'due_on',
	'state',
	'done_on',
	'dismiss_reason',
	'evidence_file',
	'occurrence_key',
	'facts',
	'company_id',
	'settings_id'
] as const;
const update_columns = [
	'due_on',
	'state',
	'done_on',
	'dismiss_reason',
	'evidence_file',
	'facts'
] as const;

export default collection('regulatory_task', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
