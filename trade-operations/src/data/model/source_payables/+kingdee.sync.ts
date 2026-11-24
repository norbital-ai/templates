import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readPayables } from '../../../integration/kingdee/payables.js';

export default sync('source_payables', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1h',
	read: function* ({ instance, cursor, local_unchanged }, ctx) {
		return fromSource(yield* readPayables(instance, cursor, ctx, local_unchanged), instance);
	}
});
