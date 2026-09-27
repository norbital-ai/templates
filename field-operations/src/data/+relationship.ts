import { relationship } from '@norbital-ai/bolt';

/**
 * Everything hangs off a job assignment, and a job assignment off its site. An assignment names the person who holds
 * the work directly (`sys_user`): a contractor is a member whose team holds `field_ops_contractor`, not a record.
 *
 * A review's or a finding's cited photo is a pointer into the evidence, never a hold on it: deleting the photo keeps
 * the audit row and clears the citation.
 */
export default relationship({
	'job_assignments.site_id': { to: 'sites', inverse: 'job_assignments' },
	'job_assignments.assignee_user_id': { to: 'sys_user', optional: true },
	'communication_logs.job_assignment_id': { to: 'job_assignments', inverse: 'communication_logs' },
	'variation_requests.job_assignment_id': { to: 'job_assignments', inverse: 'variation_requests' },
	'photo_evidence.job_assignment_id': {
		to: 'job_assignments',
		inverse: 'photo_evidence',
		optional: true
	},
	'photo_evidence.variation_request_id': {
		to: 'variation_requests',
		inverse: 'photo_evidence',
		optional: true
	},
	'suspicion_reviews.job_assignment_id': { to: 'job_assignments', inverse: 'suspicion_reviews' },
	'suspicion_reviews.evidence_id': { to: 'photo_evidence', optional: true, onDelete: 'setNull' },
	'suspicious_activity_logs.job_assignment_id': {
		to: 'job_assignments',
		inverse: 'suspicious_activity_logs'
	},
	'suspicious_activity_logs.review_id': {
		to: 'suspicion_reviews',
		inverse: 'suspicious_activity_logs',
		optional: true
	},
	'suspicious_activity_logs.evidence_id': {
		to: 'photo_evidence',
		optional: true,
		onDelete: 'setNull'
	},
	'suspicious_activity_logs.resolved_by': { to: 'sys_user', optional: true, onDelete: 'setNull' }
});
