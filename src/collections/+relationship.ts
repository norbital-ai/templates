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
		permits_to_work_certification_types: r.many.permits_to_work_certification_types(),
		permits_to_work_workers: r.many.permits_to_work_workers()
	},
	/** Join rows are first-class collections; each side of the pair is an ordinary `one` edge. */
	permits_to_work_certification_types: {
		permit_link: r.one.permits_to_work({
			from: r.permits_to_work_certification_types.permits_to_work_id,
			to: r.permits_to_work.id
		}),
		certification_type_link: r.one.certification_types({
			from: r.permits_to_work_certification_types.certification_type_id,
			to: r.certification_types.id
		})
	},
	permits_to_work_workers: {
		permit_link: r.one.permits_to_work({
			from: r.permits_to_work_workers.permits_to_work_id,
			to: r.permits_to_work.id
		}),
		worker_link: r.one.workers({
			from: r.permits_to_work_workers.worker_id,
			to: r.workers.id
		})
	},
	certification_types: {
		permits_to_work_certification_types: r.many.permits_to_work_certification_types(),
		jobs_certification_types: r.many.jobs_certification_types()
	},
	workers: {
		permits_to_work_workers: r.many.permits_to_work_workers(),
		job_assignment_worker: r.many.job_assignments()
	},
	jobs: {
		jobs_projects: r.one.projects({
			from: r.jobs.project_id,
			to: r.projects.id
		}),
		jobs_certification_types: r.many.jobs_certification_types(),
		jobs_site_locations: r.many.jobs_site_locations(),
		job_assignment_job: r.many.job_assignments()
	},
	jobs_certification_types: {
		job_link: r.one.jobs({
			from: r.jobs_certification_types.job_id,
			to: r.jobs.id
		}),
		certification_type_link: r.one.certification_types({
			from: r.jobs_certification_types.certification_type_id,
			to: r.certification_types.id
		})
	},
	jobs_site_locations: {
		job_link: r.one.jobs({
			from: r.jobs_site_locations.job_id,
			to: r.jobs.id
		}),
		site_location_link: r.one.site_locations({
			from: r.jobs_site_locations.site_location_id,
			to: r.site_locations.id
		})
	},
	site_locations: {
		site_locations_projects: r.one.projects({
			from: r.site_locations.project_id,
			to: r.projects.id
		}),
		jobs_site_locations: r.many.jobs_site_locations(),
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
