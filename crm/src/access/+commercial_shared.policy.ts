import { policy } from '@norbital-ai/bolt';

/** Settlement authority shared by sales and procurement, owned once for unambiguous composition. */
export default policy({
	description: 'Shared settlement ledger.',
	grants: { settlements: { read: true, create: true, queries: ['settlement_summary'] } }
});
