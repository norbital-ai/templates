import { Effect } from 'effect';
import type { Hooks } from './$types.js';

export default {
	update: {
		perRecord: {
			before: {
				description: 'Keeps every automated suspicion decision and its evidence basis immutable.',
				handler: () =>
					Effect.fail(new Error('Automated suspicion reviews cannot be changed after inference.'))
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains automated suspicion reviews as a durable inference audit trail.',
				handler: () => Effect.fail(new Error('Automated suspicion reviews cannot be deleted.'))
			}
		}
	}
} satisfies Hooks;
