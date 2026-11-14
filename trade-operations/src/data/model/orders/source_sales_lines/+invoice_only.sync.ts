import { sync } from '@norbital-ai/bolt';
import { fromSource } from '../../../../integration/kingdee/polling.js';
import { readInvoiceAnalysis } from '../../../../integration/kingdee/invoice-analysis.js';

export default sync('source_sales_lines', 'invoice_only', {
	with: 'kingdee',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(yield* readInvoiceAnalysis(instance, cursor, ctx), instance);
	}
});
