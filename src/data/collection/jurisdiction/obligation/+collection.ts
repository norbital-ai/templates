import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'duty_code',
	'authority',
	'occurrence_key',
	'trigger_ref',
	'triggered_on',
	'due_on',
	'amount_due',
	'amount_settled',
	'state',
	'fulfilled_on',
	'waive_reason',
	'reference',
	'evidence_file',
	'facts',
	'company_id',
	'settings_id'
] as const;
const update_columns = [
	'due_on',
	'amount_due',
	'amount_settled',
	'state',
	'fulfilled_on',
	'waive_reason',
	'reference',
	'evidence_file',
	'facts'
] as const;

export default collection('obligation', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
