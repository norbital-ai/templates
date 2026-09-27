import { collection } from '@norbital-ai/bolt';

const columns = [
	'claim_number',
	'project_id',
	'job_id',
	'claim_type',
	'status',
	'currency',
	'claimed_amount',
	'certified_amount',
	'claim_period',
	'submitted_date',
	'paid_date',
	'description',
	'supporting_documents'
] as const;

export default collection('payment_claims', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
