import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readPurchaseReceipts } from '../../../integration/kingdee/purchases.js';

export default sync('source_purchase_lines', 'receipts', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '5min',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readPurchaseReceipts(instance, cursor, ctx), instance);
	}
});
