import type { Relationships } from './$types.js';

/**
 * `r.one.user` is the identity table, reachable as a foreign-key target and nothing else.
 *
 * An assignment's assignee is a person, so it points at `user` — the only description of a
 * person a bolt has. There is deliberately no collection wrapping it: a second table describing the
 * same people would restate a directory the runtime already owns, and give a contractor a record they
 * could fail to have.
 */
export default ((r) => ({
	sites: {
		site_jobs: r.many.jobs()
	},
	jobs: {
		site_jobs: r.one.sites({
			from: r.jobs.site_id,
			to: r.sites.id
		}),
		job_assignment_job: r.many.job_assignments()
	},
	suspicious_activity_logs: {
		job_assignment_suspicions: r.one.job_assignments({
			from: r.suspicious_activity_logs.job_assignment_id,
			to: r.job_assignments.id
		}),
		suspicion_log_review: r.one.suspicion_reviews({
			from: r.suspicious_activity_logs.review_id,
			to: r.suspicion_reviews.id
		}),
		suspicion_log_evidence: r.one.photo_evidence({
			from: r.suspicious_activity_logs.evidence_id,
			to: r.photo_evidence.id
		})
	},
	suspicion_reviews: {
		job_assignment_suspicion_reviews: r.one.job_assignments({
			from: r.suspicion_reviews.job_assignment_id,
			to: r.job_assignments.id
		}),
		suspicion_review_logs: r.many.suspicious_activity_logs(),
		suspicion_review_evidence: r.one.photo_evidence({
			from: r.suspicion_reviews.evidence_id,
			to: r.photo_evidence.id
		})
	},
	communication_logs: {
		job_assignment_communications: r.one.job_assignments({
			from: r.communication_logs.job_assignment_id,
			to: r.job_assignments.id
		})
	},
	job_assignments: {
		job_assignment_communications: r.many.communication_logs(),
		job_assignment_job: r.one.jobs({
			from: r.job_assignments.job_id,
			to: r.jobs.id
		}),
		job_assignment_assignee: r.one.user({
			from: r.job_assignments.assignee_user_id,
			to: r.user.id
		}),
		job_assignment_photo_evidence: r.many.photo_evidence(),
		job_assignment_variations: r.many.variation_requests()
	},
	variation_requests: {
		job_assignment_variations: r.one.job_assignments({
			from: r.variation_requests.job_assignment_id,
			to: r.job_assignments.id
		}),
		variation_request_photo_evidence: r.many.photo_evidence()
	},
	photo_evidence: {
		job_assignment_photo_evidence: r.one.job_assignments({
			from: r.photo_evidence.job_assignment_id,
			to: r.job_assignments.id
		}),
		variation_request_photo_evidence: r.one.variation_requests({
			from: r.photo_evidence.variation_request_id,
			to: r.variation_requests.id
		})
	}
})) satisfies Relationships;
