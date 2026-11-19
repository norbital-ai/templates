import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockLotCosts } from '../../../integration/kingdee/stock-lot-costs.js';

export default sync('source_lot_costs', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	read: function* ({ instance, cursor, local_unchanged }, ctx) {
		return fromSource(yield* readStockLotCosts(instance, cursor, ctx, local_unchanged), instance);
	}
});
