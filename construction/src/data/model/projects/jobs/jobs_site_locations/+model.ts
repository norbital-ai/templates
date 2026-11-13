import { model } from '../../../../../../.norbital/models/jobs_site_locations.ts';
const columns = ['job_id', 'site_location_id'] as const;
/** A join row: both sides are `ref` fields, and it is labelled by theirs. */
export default model({
	description: 'Join table linking jobs to site locations.',
	record_label: "record.job_id.job_title + ' · ' + record.site_location_id.location_name",
	fields: {
		job_id: { kind: 'ref', to: 'jobs', inverse: 'jobs_site_locations' },
		site_location_id: { kind: 'ref', to: 'site_locations', inverse: 'jobs_site_locations' }
	},
	outputs: {
		default: {
			fields: 'all',
			job_id: { fields: ['job_title'] },
			site_location_id: { fields: ['location_name'] }
		}
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
