import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readPurchaseListing } from '../../../integration/kingdee/purchase-listing.js';

export default sync('source_purchase_orders', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1h',
	read: function* ({ instance, cursor, local_unchanged }, ctx) {
		return fromSource(yield* readPurchaseListing(instance, cursor, ctx, local_unchanged), instance);
	}
});
