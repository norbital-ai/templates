import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockCommitments } from '../../../integration/kingdee/stock-commitments.js';

export default sync('source_stock_commitments', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '5min',
	read: function* ({ instance, cursor, local_unchanged }, ctx) {
		return fromSource(
			yield* readStockCommitments(instance, cursor, ctx, local_unchanged),
			instance
		);
	}
});
