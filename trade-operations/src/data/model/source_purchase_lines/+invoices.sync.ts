import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readPurchaseInvoices } from '../../../integration/kingdee/purchases.js';

export default sync('source_purchase_lines', 'invoices', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '5min',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readPurchaseInvoices(instance, cursor, ctx), instance);
	}
});
