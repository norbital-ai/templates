import { sync } from '@norbital-ai/bolt';
import { readCreditSource } from '../../../../integration/kingdee/credit-source.js';
import { fromSource } from '../../../../integration/kingdee/polling.js';

export default sync('credit_snapshots', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readCreditSource(instance, cursor, ctx), instance);
	}
});
