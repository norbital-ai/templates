import { model } from '@norbital-ai/bolt';

/** A join row: both sides are relationships (`src/data/+relationship.ts`). */
export default model({
	description: 'Join table linking jobs to site locations.',
	label: ['job_id', 'site_location_id'],
	fields: {}
});
