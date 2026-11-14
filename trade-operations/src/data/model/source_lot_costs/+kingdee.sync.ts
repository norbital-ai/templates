import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockLotCosts } from '../../../integration/kingdee/stock-lot-costs.js';

export default sync('source_lot_costs', 'kingdee', {
	with: 'kingdee',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readStockLotCosts(instance, cursor, ctx), instance);
	}
});
