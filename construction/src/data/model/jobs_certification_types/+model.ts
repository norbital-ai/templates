import { model } from '@norbital-ai/bolt';

/** A join row: both sides are relationships (`src/data/+relationship.ts`). */
export default model({
	description: 'Join table linking jobs to required certification types.',
	label: ['job_id', 'certification_type_id'],
	fields: {}
});
