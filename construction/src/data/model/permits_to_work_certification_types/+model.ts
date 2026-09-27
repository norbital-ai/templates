import { model } from '@norbital-ai/bolt';

/** A join row: both sides are relationships (`src/data/+relationship.ts`). */
export default model({
	description: 'Join table linking permits to work to certification types.',
	label: ['permits_to_work_id', 'certification_type_id'],
	fields: {}
});
