import { collection } from '@norbital-ai/bolt';

/**
 * A variation is raised against one job assignment; the message it came from is create-only. Raising or changing one
 * as a contractor is held for a Field Operations Controllers approval (the contractor policy's grant).
 */
export default collection('variation_requests', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'job_assignment_id',
				'requested_at',
				'title',
				'description',
				'amount',
				'source_message_id'
			]
		}
	},
	update: {
		input: { columns: ['job_assignment_id', 'requested_at', 'title', 'description', 'amount'] }
	},
	delete: {}
});
