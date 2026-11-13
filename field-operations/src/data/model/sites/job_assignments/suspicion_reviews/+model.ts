import { model } from '../../../../../../.norbital/models/suspicion_reviews.ts';
import { REVIEW_BASIS } from '../../../../../lib/basis.js';
/** An immutable inference audit ledger: the review automation appends; nothing changes or deletes a row. */
export default model({
	description:
		'Controller-only audit ledger for every automated suspicion review, including clear decisions that must not create a suspicion log.',
	icon: 'lucide:scan-search',
	record_label: 'record.reason',
	fields: {
		job_assignment_id: { kind: 'ref', to: 'job_assignments', inverse: 'suspicion_reviews' },
		/** The cited photo is a pointer into the evidence, never a hold on it: deleting the photo clears the citation. */
		evidence_id: { kind: 'ref', to: 'photo_evidence', optional: true, on_delete: 'set_null' },
		/** SHA-256 of `basis`. */
		basis_hash: { kind: 'text', hidden: true },
		/** Canonical snapshot of the facts supplied to inference. */
		basis: { kind: 'json', shape: REVIEW_BASIS },
		suspicious: { kind: 'bool' },
		reason: { kind: 'text' },
		model: { kind: 'text' },
		reviewed_at: { kind: 'instant' },
		/** One review per assignment and evidence basis, even when a run is retried. */
		source_key: { kind: 'text', hidden: true }
	},
	constraints: {
		source_key: { unique: ['source_key'] },
		one_review_per_basis: { unique: ['job_assignment_id', 'basis_hash'] }
	},
	indexes: {
		reviewed_at: { on: ['reviewed_at'] },
		search: { text: ['reason'] }
	},
	outputs: {
		default: {
			fields: 'all',
			job_assignment_id: { fields: ['title'] },
			evidence_id: { fields: ['source'] }
		}
	},
	create: {
		columns: {
			fields: [
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
	}
});
