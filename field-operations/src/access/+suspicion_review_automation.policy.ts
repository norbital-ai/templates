import { policy } from '@norbital-ai/bolt';

const UNCHECKED = { suspicion_checked_at: { isNull: true } } as const;
const UNCHECKED_JOB = { job_assignment_id: { is: UNCHECKED } } as const;

/**
 * The review run's authority. It inspects any photo still awaiting facts (so it reads every assignment, site,
 * variation and photo), and judges only unchecked assignments: the private ledgers and messages it reads and appends
 * are scoped to those. Each write is one transition: a photo's facts once (`previous` empty hash), and an unchecked
 * job's stamp once.
 */
export default policy({
	description:
		'Inspects filed photos awaiting facts, reviews unchecked assignments, appends immutable suspicion evidence, and marks a completed review checked.',
	grants: {
		job_assignments: {
			read: true,
			update: {
				previous: UNCHECKED,
				where: { suspicion_checked_at: { isNull: false } },
				fields: ['suspicion_checked_at']
			}
		},
		sites: { read: true },
		variation_requests: { read: true },
		photo_evidence: {
			read: true,
			update: {
				// a photo awaiting inspection, or a hashed one (seeded, bank-loaded) still without a scene
				previous: { or: [{ sha256: { eq: '' } }, { scene_embedding: { isNull: true } }] },
				fields: [
					'sha256',
					'inspection_failed_at',
					'inspection_failure_reason',
					'perceptual_embedding',
					'scene_embedding',
					'flags',
					'matched_evidence_ids'
				]
			}
		},
		communication_logs: { read: UNCHECKED_JOB },
		suspicious_activity_logs: {
			read: UNCHECKED_JOB,
			create: {
				where: { origin: { eq: 'automation' }, job_assignment_id: { is: UNCHECKED } },
				fields: ['job_assignment_id', 'origin', 'basis', 'review_id', 'evidence_id', 'reason']
			}
		},
		suspicion_reviews: {
			read: UNCHECKED_JOB,
			create: {
				where: UNCHECKED_JOB,
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
	},
	limits: { act: '600/min', read: '600/min', agent: '500/h' }
});
