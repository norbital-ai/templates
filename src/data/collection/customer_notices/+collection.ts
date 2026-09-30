import { collection } from '@norbital-ai/bolt';

/** Append-only: a notice is filed once; only its delivery is recorded afterwards, by the `deliver_notices` run. */
export default collection('customer_notices', {
	read: { fields: 'all' },
	create: { input: { columns: ['customer', 'visit', 'subject', 'body'] } },
	update: { input: { columns: ['delivery'] } }
});
