import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description: 'Keeps every automated suspicion decision and its evidence basis immutable.',
				handler: ({ input, existing }) =>
					existing === undefined
						? input
						: refuse('Automated suspicion reviews cannot be changed after inference.')
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains automated suspicion reviews as a durable inference audit trail.',
				handler: () => refuse('Automated suspicion reviews cannot be deleted.')
			}
		}
	}
} satisfies Hooks;
