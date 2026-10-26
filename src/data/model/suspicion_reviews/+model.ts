import { model } from '@norbital-ai/bolt';
import { REVIEW_BASIS } from '../../../lib/basis.js';
/** An immutable inference audit ledger: the review automation appends; nothing changes or deletes a row. */
export default model('suspicion_reviews', {
	description:
		'Controller-only audit ledger for every automated suspicion review, including clear decisions that must not create a suspicion log.',
	icon: 'lucide:scan-search',
	label: 'reason',
	fields: {
		job_assignment_id: { kind: 'ref', to: 'job_assignments', inverse: 'suspicion_reviews' },
		/** The cited photo is a pointer into the evidence, never a hold on it: deleting the photo clears the citation. */
		evidence_id: { kind: 'ref', to: 'photo_evidence', optional: true, onDelete: 'setNull' },
		/** SHA-256 of `basis`. */
		basis_hash: { kind: 'text' },
		/** Canonical snapshot of the facts supplied to inference. */
		basis: { kind: 'json', shape: REVIEW_BASIS },
		suspicious: { kind: 'bool' },
		reason: { kind: 'text' },
		model: { kind: 'text' },
		reviewed_at: { kind: 'instant' },
		/** One review per assignment and evidence basis, even when a run is retried. */
		source_key: { kind: 'text', unique: true }
	},
	unique: [{ fields: ['job_assignment_id', 'basis_hash'] }],
	index: ['reviewed_at'],
	search: { text: ['reason'] },
	read: 'all',
	create: {
		columns: [
			'job_assignment_id',
			'basis_hash',
			'basis',
			'suspicious',
			'reason',
			'evidence_id',
			'model',
			'reviewed_at',
			'source_key'
		]
	}
});
