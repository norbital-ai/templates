import { seeder } from '@norbital-ai/bolt';

/** The demo's private rows: `seed_bank/field-operations/rows/**` (docs/seeding.md). */
export default seeder({
	bank: { tree: 'field-operations', start: ['review_job_assignment_suspicion'] }
});
