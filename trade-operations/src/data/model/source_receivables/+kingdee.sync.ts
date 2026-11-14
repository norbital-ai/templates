import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readReceivables } from '../../../integration/kingdee/receivables.js';

export default sync('source_receivables', 'kingdee', {
	with: 'kingdee',
	every: '1h',
	read: function* ({ instance, cursor }, ctx) {
		return fromSource(yield* readReceivables(instance, cursor, ctx), instance);
	}
});
