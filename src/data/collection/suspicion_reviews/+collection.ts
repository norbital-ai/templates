import { collection } from '@norbital-ai/bolt';

/** An immutable inference audit ledger: the review automation appends; nothing changes or deletes a row. */
export default collection('suspicion_reviews', {
	read: { fields: 'all' },
	create: {
		input: {
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
	}
});
