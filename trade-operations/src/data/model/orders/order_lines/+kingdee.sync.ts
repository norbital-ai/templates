import { sync } from '@norbital-ai/bolt';
import {
	importedLineId,
	pushOrder,
	readKingdeeOrderLines
} from '../../../../integration/kingdee/orders.js';

// The Kingdee SO's or PO's lines: the read mirrors each entry, a write sends the whole order.
export default sync('order_lines', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return yield* readKingdeeOrderLines(instance, cursor, ctx);
	},
	write: function* ({ op, row, instance }, ctx) {
		if (op === 'create') {
			const imported = yield* importedLineId(row, ctx);
			if (imported) return { $id: imported };
		}
		const written = yield* pushOrder(row.order, instance, ctx);
		const entry = written?.lines.find((line) => line.line === row.id);
		return op === 'delete' || !written || !entry ? null : { $id: `${written.$id}:${entry.entry}` };
	}
});
