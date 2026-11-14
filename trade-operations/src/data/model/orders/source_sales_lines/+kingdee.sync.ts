import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../../integration/kingdee/polling.js';
import { readSalesFactSource } from '../../../../integration/kingdee/financial-source.js';

export default sync('source_sales_lines', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(yield* readSalesFactSource(instance, cursor, ctx), instance);
	}
});
