import { sync } from '@norbital-ai/bolt';
import { pushOrder, readKingdeeOrderLines } from '../../../../integration/kingdee/sales-orders.js';

// The Kingdee SO's lines: the read mirrors each entry, a write sends the whole order.
export default sync('order_lines', 'kingdee', {
	with: 'kingdee',
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return yield* readKingdeeOrderLines(instance, cursor, ctx);
	},
	write: function* ({ op, row, instance }, ctx) {
		const written = yield* pushOrder(row.order, instance, ctx);
		const entry = written?.lines.find((line) => line.line === row.id);
		return op === 'delete' || !written || !entry ? null : { $id: `${written.$id}:${entry.entry}` };
	}
});
