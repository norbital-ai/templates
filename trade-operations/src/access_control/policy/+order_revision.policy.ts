import { policy } from '@norbital-ai/bolt';
export default policy({
	description:
		'Reopens a confirmed order as a replacement draft; a start names only an order its starter reads.',
	grants: {
		orders: { read: true, update: true, moves: { status: ['confirmed->draft'] } },
		order_lines: { read: true, create: true, update: true, delete: true }
	}
});
