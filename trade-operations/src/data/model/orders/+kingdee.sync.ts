import { pushOrder, readKingdeeOrders } from '../../../integration/kingdee/sales-orders.js';
import { sync } from '@norbital-ai/bolt';

// The Kingdee SO: the read mirrors its header, the write creates it or amends its lines.
export default sync('orders', 'kingdee', {
	with: 'kingdee',
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return yield* readKingdeeOrders(instance, cursor, ctx);
	},
	write: function* ({ op, row, instance }, ctx) {
		if (op === 'delete') return null;
		// no `$version`: the read brings the SO's own state back, which this order does not hold yet
		const written = yield* pushOrder(row.id, instance, ctx);
		return written && { $id: written.$id };
	}
});
