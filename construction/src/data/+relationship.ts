import { relationship } from '@norbital-ai/bolt';

/**
 * Every reference in the workspace. The references the old models declared as relationships keep their FK and its
 * `restrict` delete rule; the plain id columns that pickers already treated as references (a defect's job, a job's
 * BIM reference, a permit's worker, a sub-location's parent …) are optional relationships that clear on delete.
 */
export default relationship({
	'site_locations.project_id': { to: 'projects', inverse: 'site_locations', optional: true },
	'site_locations.parent_location_id': {
		to: 'site_locations',
		inverse: 'child_locations',
		optional: true,
		onDelete: 'setNull'
	},
	'rfis.project_id': { to: 'projects', inverse: 'rfis', optional: true },
	'rfis.related_defect_id': {
		to: 'defects',
		inverse: 'related_rfis',
		optional: true,
		onDelete: 'setNull'
	},
	'defects.project_id': { to: 'projects', inverse: 'defects', optional: true },
	'defects.site_location_id': {
		to: 'site_locations',
		inverse: 'defects',
		optional: true,
		onDelete: 'setNull'
	},
	'defects.job_id': { to: 'jobs', inverse: 'defects', optional: true, onDelete: 'setNull' },
	'payment_claims.project_id': { to: 'projects', inverse: 'payment_claims', optional: true },
	'payment_claims.job_id': {
		to: 'jobs',
		inverse: 'payment_claims',
		optional: true,
		onDelete: 'setNull'
	},
	'asset_documents.project_id': { to: 'projects', inverse: 'asset_documents', optional: true },
	'asset_documents.site_location_id': {
		to: 'site_locations',
		inverse: 'asset_documents',
		optional: true,
		onDelete: 'setNull'
	},
	'bim_reference_matrix.project_id': {
		to: 'projects',
		inverse: 'bim_references',
		optional: true,
		onDelete: 'setNull'
	},
	'jobs.project_id': { to: 'projects', inverse: 'jobs', optional: true },
	'jobs.site_location_id': {
		to: 'site_locations',
		inverse: 'jobs',
		optional: true,
		onDelete: 'setNull'
	},
	'jobs.bim_reference_id': {
		to: 'bim_reference_matrix',
		inverse: 'jobs',
		optional: true,
		onDelete: 'setNull'
	},
	'permits_to_work.project_id': { to: 'projects', inverse: 'permits_to_work', optional: true },
	'permits_to_work.site_location_id': {
		to: 'site_locations',
		inverse: 'permits_to_work',
		optional: true,
		onDelete: 'setNull'
	},
	'permits_to_work.job_id': {
		to: 'jobs',
		inverse: 'permits_to_work',
		optional: true,
		onDelete: 'setNull'
	},
	'permits_to_work.worker_id': {
		to: 'workers',
		inverse: 'permits_to_work',
		optional: true,
		onDelete: 'setNull'
	},
	'permits_to_work_certification_types.permits_to_work_id': {
		to: 'permits_to_work',
		inverse: 'permits_to_work_certification_types'
	},
	'permits_to_work_certification_types.certification_type_id': {
		to: 'certification_types',
		inverse: 'permits_to_work_certification_types'
	},
	'permits_to_work_workers.permits_to_work_id': {
		to: 'permits_to_work',
		inverse: 'permits_to_work_workers'
	},
	'permits_to_work_workers.worker_id': { to: 'workers', inverse: 'permits_to_work_workers' },
	'jobs_certification_types.job_id': { to: 'jobs', inverse: 'jobs_certification_types' },
	'jobs_certification_types.certification_type_id': {
		to: 'certification_types',
		inverse: 'jobs_certification_types'
	},
	'jobs_site_locations.job_id': { to: 'jobs', inverse: 'jobs_site_locations' },
	'jobs_site_locations.site_location_id': {
		to: 'site_locations',
		inverse: 'jobs_site_locations'
	},
	'job_assignments.worker_id': { to: 'workers', inverse: 'job_assignments' },
	'job_assignments.job_id': { to: 'jobs', inverse: 'job_assignments', optional: true },
	'job_assignments.site_location_id': { to: 'site_locations', inverse: 'job_assignments' }
});
