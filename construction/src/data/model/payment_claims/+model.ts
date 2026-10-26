import { model } from '@norbital-ai/bolt';
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
export default model('payment_claims', {
	description: 'Commercial claim records with readiness and submission state.',
	icon: 'lucide:banknote',
	label: 'claim_number',
	fields: {
		claim_number: { kind: 'text', unique: true },
		claim_type: { kind: 'enum', values: ['progress', 'variation', 'final'], optional: true },
		status: {
			kind: 'enum',
			values: ['draft', 'submitted', 'certified', 'paid', 'rejected'],
			optional: true
		},
		/** One currency for the claim: claimed and certified are two amounts of the same money. */
		currency: { kind: 'currency', optional: true },
		claimed_amount: { kind: 'money', currency: 'currency', optional: true },
		certified_amount: { kind: 'money', currency: 'currency', optional: true },
		claim_period: { kind: 'period', of: 'date', optional: true },
		submitted_date: { kind: 'date', optional: true },
		paid_date: { kind: 'date', optional: true },
		description: { kind: 'text', optional: true },
		supporting_documents: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			multiple: true,
			optional: true
		},
		project_id: { kind: 'ref', to: 'projects', inverse: 'payment_claims', optional: true },
		job_id: {
			kind: 'ref',
			to: 'jobs',
			inverse: 'payment_claims',
			optional: true,
			onDelete: 'setNull'
		}
	},
	search: { text: ['claim_number'] },
	read: 'all',
	create: { columns },
	update: { columns }
});
