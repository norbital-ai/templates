import type { Policy } from './$types.js';

/** Sole read owner for the account master shared by the sales desk and its ERP mirror. */
export default {
	description: 'Reads the account master shared by sales and the ERP customer import.',
	grants: {
		accounts: { read: {} }
	}
} satisfies Policy;
