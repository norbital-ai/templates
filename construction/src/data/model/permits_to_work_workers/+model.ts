import { model } from '@norbital-ai/bolt';

/** A join row: both sides are relationships (`src/data/+relationship.ts`). */
export default model({
	description: 'Join table linking permits to work to workers.',
	label: ['permits_to_work_id', 'worker_id'],
	fields: {}
});
