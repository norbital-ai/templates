import { model } from '../../../../../../.norbital/models/permits_to_work_workers.ts';
const columns = ['permits_to_work_id', 'worker_id'] as const;
/** A join row: both sides are `ref` fields, and it is labelled by theirs. */
export default model({
	description: 'Join table linking permits to work to workers.',
	record_label: "record.permits_to_work_id.permit_number + ' · ' + record.worker_id.worker_name",
	fields: {
		permits_to_work_id: { kind: 'ref', to: 'permits_to_work', inverse: 'permits_to_work_workers' },
		worker_id: { kind: 'ref', to: 'workers', inverse: 'permits_to_work_workers' }
	},
	outputs: {
		default: {
			fields: 'all',
			permits_to_work_id: { fields: ['permit_number'] },
			worker_id: { fields: ['worker_name'] }
		}
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
