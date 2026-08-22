import type { Relationships } from './$types.js';

export default ((r) => ({
	projects: {
		site_locations_projects: r.many.site_locations(),
		rfis_projects: r.many.rfis(),
		defects_projects: r.many.defects(),
		jobs_projects: r.many.jobs(),
		payment_claims_projects: r.many.payment_claims(),
		permits_to_work_projects: r.many.permits_to_work(),
		asset_documents_projects: r.many.asset_documents()
	},
	rfis: {
		rfis_projects: r.one.projects({
			from: r.rfis.project_id,
			to: r.projects.id
		})
	},
	defects: {
		defects_projects: r.one.projects({
			from: r.defects.project_id,
			to: r.projects.id
		})
	},
	payment_claims: {
		payment_claims_projects: r.one.projects({
			from: r.payment_claims.project_id,
			to: r.projects.id
		})
	},
	asset_documents: {
		asset_documents_projects: r.one.projects({
			from: r.asset_documents.project_id,
			to: r.projects.id
		})
	},
	permits_to_work: {
		permits_to_work_projects: r.one.projects({
			from: r.permits_to_work.project_id,
			to: r.projects.id
		}),
		permits_to_work_certification_types: r.many.certification_types({
			from: r.permits_to_work.id.through(r.permits_to_work_certification_types.permits_to_work_id),
			to: r.certification_types.id.through(
				r.permits_to_work_certification_types.certification_type_id
			)
		}),
		permits_to_work_workers: r.many.workers({
			from: r.permits_to_work.id.through(r.permits_to_work_workers.permits_to_work_id),
			to: r.workers.id.through(r.permits_to_work_workers.worker_id)
		})
	},
	certification_types: {
		permits_to_work_certification_types: r.many.permits_to_work(),
		jobs_certification_types: r.many.jobs()
	},
	workers: {
		permits_to_work_workers: r.many.permits_to_work(),
		job_assignment_worker: r.many.job_assignments()
	},
	jobs: {
		jobs_projects: r.one.projects({
			from: r.jobs.project_id,
			to: r.projects.id
		}),
		jobs_certification_types: r.many.certification_types({
			from: r.jobs.id.through(r.jobs_certification_types.job_id),
			to: r.certification_types.id.through(r.jobs_certification_types.certification_type_id)
		}),
		jobs_site_locations: r.many.site_locations({
			from: r.jobs.id.through(r.jobs_site_locations.job_id),
			to: r.site_locations.id.through(r.jobs_site_locations.site_location_id)
		}),
		job_assignment_job: r.many.job_assignments()
	},
	site_locations: {
		site_locations_projects: r.one.projects({
			from: r.site_locations.project_id,
			to: r.projects.id
		}),
		jobs_site_locations: r.many.jobs(),
		job_assignment_site_location: r.many.job_assignments()
	},
	job_assignments: {
		job_assignment_worker: r.one.workers({
			from: r.job_assignments.worker_id,
			to: r.workers.id
		}),
		job_assignment_job: r.one.jobs({
			from: r.job_assignments.job_id,
			to: r.jobs.id
		}),
		job_assignment_site_location: r.one.site_locations({
			from: r.job_assignments.site_location_id,
			to: r.site_locations.id
		})
	}
})) satisfies Relationships;
