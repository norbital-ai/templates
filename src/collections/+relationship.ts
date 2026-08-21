import type { Relationships } from './$types.js';

/**
 * `r.one.user` is the identity table, reachable as a foreign-key target and nothing else.
 *
 * An assignment's assignee is a person, so it points at `bolt_auth_user` — the only description of a
 * person a bolt has. There is deliberately no collection wrapping it and no `contractor_profiles`
 * standing in for one; a second table describing the same people is exactly what this workspace used
 * to carry, and what it now does not.
 */
export default ((r) => ({
	sites: {
		site_jobs: r.many.jobs()
	},
	jobs: {
		site_jobs: r.one.sites({
			from: r.jobs.site_id,
			to: r.sites.norbital_id
		}),
		job_assignment_job: r.many.job_assignments()
	},
	suspicious_activity_logs: {
		job_assignment_suspicions: r.one.job_assignments({
			from: r.suspicious_activity_logs.job_assignment_id,
			to: r.job_assignments.norbital_id
		})
	},
	job_assignments: {
		job_assignment_suspicions: r.many.suspicious_activity_logs(),
		job_assignment_job: r.one.jobs({
			from: r.job_assignments.job_id,
			to: r.jobs.norbital_id
		}),
		job_assignment_assignee: r.one.user({
			from: r.job_assignments.assignee_user_id,
			to: r.user.norbital_id
		}),
		job_assignment_photo_evidence: r.many.photo_evidence(),
		job_assignment_variations: r.many.variation_requests()
	},
	variation_requests: {
		job_assignment_variations: r.one.job_assignments({
			from: r.variation_requests.job_assignment_id,
			to: r.job_assignments.norbital_id
		}),
		variation_request_photo_evidence: r.many.photo_evidence()
	},
	photo_evidence: {
		job_assignment_photo_evidence: r.one.job_assignments({
			from: r.photo_evidence.job_assignment_id,
			to: r.job_assignments.norbital_id
		}),
		variation_request_photo_evidence: r.one.variation_requests({
			from: r.photo_evidence.variation_request_id,
			to: r.variation_requests.norbital_id
		})
	}
})) satisfies Relationships;
