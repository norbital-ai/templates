import { sync } from '@norbital-ai/bolt';
import { readCreditSource } from '../../../../integration/kingdee/credit-source.js';
import { fromSource } from '../../../../integration/kingdee/polling.js';

export default sync('credit_snapshots', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ instance, cursor, local_unchanged }, ctx) {
		return fromSource(yield* readCreditSource(instance, cursor, ctx, local_unchanged), instance);
	}
});
