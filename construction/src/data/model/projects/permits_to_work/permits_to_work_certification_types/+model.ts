import { model } from '../../../../../../.norbital/models/permits_to_work_certification_types.ts';
const columns = ['permits_to_work_id', 'certification_type_id'] as const;
/** A join row: both sides are `ref` fields, and it is labelled by theirs. */
export default model({
	description: 'Join table linking permits to work to certification types.',
	record_label:
		"record.permits_to_work_id.permit_number + ' · ' + record.certification_type_id.certification_name",
	fields: {
		permits_to_work_id: {
			kind: 'ref',
			to: 'permits_to_work',
			inverse: 'permits_to_work_certification_types'
		},
		certification_type_id: {
			kind: 'ref',
			to: 'certification_types',
			inverse: 'permits_to_work_certification_types'
		}
	},
	outputs: {
		default: {
			fields: 'all',
			permits_to_work_id: { fields: ['permit_number'] },
			certification_type_id: { fields: ['certification_name'] }
		}
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
