import { fromSource } from '../../../../integration/kingdee/polling.js';
import { readTransactions } from '../../../../integration/kingdee/order-source.js';
import { sync } from '@norbital-ai/bolt';

export default sync('transactions', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '5min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(yield* readTransactions(instance, cursor, ctx), instance);
	}
});
