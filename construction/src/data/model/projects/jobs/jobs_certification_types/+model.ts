import { model } from '../../../../../../.norbital/models/jobs_certification_types.ts';
const columns = ['job_id', 'certification_type_id'] as const;
/** A join row: both sides are `ref` fields, and it is labelled by theirs. */
export default model({
	description: 'Join table linking jobs to required certification types.',
	record_label: "record.job_id.job_title + ' · ' + record.certification_type_id.certification_name",
	fields: {
		job_id: { kind: 'ref', to: 'jobs', inverse: 'jobs_certification_types' },
		certification_type_id: {
			kind: 'ref',
			to: 'certification_types',
			inverse: 'jobs_certification_types'
		}
	},
	outputs: {
		default: {
			fields: 'all',
			job_id: { fields: ['job_title'] },
			certification_type_id: { fields: ['certification_name'] }
		}
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
