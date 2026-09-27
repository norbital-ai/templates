import { policy } from '@norbital-ai/bolt';

/**
 * Held by no team: the morning expiry sweep reads every rep's sent quotes (a rep's own `sales_rep` scope names no
 * one when the sweep is the actor) and writes nothing.
 */
export default policy({
	description: 'Reads quotes for the daily expiry sweep.',
	grants: {
		quotes: {
			read: {
				fields: [
					'id',
					'doc_no',
					'title',
					'status',
					'account_id',
					'owner_id',
					'gross',
					'currency',
					'valid_until'
				]
			}
		}
	}
});
