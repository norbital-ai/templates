import { fromSource } from '../../../../integration/kingdee/polling.js';
import { readPaymentSource } from '../../../../integration/kingdee/financial-source.js';
import { sync } from '@norbital-ai/bolt';

export default sync('source_payments', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '5min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(yield* readPaymentSource(instance, cursor, ctx), instance);
	}
});
