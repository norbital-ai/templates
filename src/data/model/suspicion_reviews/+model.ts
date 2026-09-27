import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Controller-only audit ledger for every automated suspicion review, including clear decisions that must not create a suspicion log.',
	icon: 'lucide:scan-search',
	label: 'reason',
	fields: {
		/** SHA-256 of `basis`. */
		basis_hash: { kind: 'text' },
		/** Canonical snapshot of the facts supplied to inference. */
		basis: { kind: 'text' },
		suspicious: { kind: 'bool' },
		reason: { kind: 'text' },
		model: { kind: 'text' },
		reviewed_at: { kind: 'instant' },
		/** One review per assignment and evidence basis, even when a run is retried. */
		source_key: { kind: 'text', unique: true }
	},
	unique: [{ fields: ['job_assignment_id', 'basis_hash'] }],
	index: ['reviewed_at'],
	search: { text: ['reason'] }
});
