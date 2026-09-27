import { collection } from '@norbital-ai/bolt';

/** Every field is the person's to set. */
const columns = [
	'name',
	'company_id',
	'lead_contact_id',
	'status',
	'start_on',
	'target_on',
	'budget_currency',
	'budget',
	'summary'
] as const;

export default collection('projects', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
