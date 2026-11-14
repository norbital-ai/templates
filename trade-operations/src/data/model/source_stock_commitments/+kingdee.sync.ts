import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockCommitments } from '../../../integration/kingdee/stock-commitments.js';

export default sync('source_stock_commitments', 'kingdee', {
	with: 'kingdee',
	every: '5min',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readStockCommitments(instance, cursor, ctx), instance);
	}
});
