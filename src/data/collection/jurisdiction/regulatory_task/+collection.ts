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
// `occurrence_key` moves when a duty is withdrawn (its exit moved or undone), so the exit as it now stands raises anew.
const update_columns = [
	'occurrence_key',
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
