import { model } from '@norbital-ai/bolt';
import { purchaseExpenseNotice, purchaseOrderEntries } from '../../../lib/purchase-listing.js';

export default model('source_purchase_orders', {
	description:
		'Verified account-wide purchase order lines by order month, with receipts, invoices, allocated customs/import VAT and payments.',
	record_label: "record.source.name + ' · ' + record.period",
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		// YYYY-MM order month
		period: { kind: 'text' },
		currency: { kind: 'currency' },
		observed_at: { kind: 'instant' },
		entries: { kind: 'json', shape: purchaseOrderEntries },
		expense_notice: { kind: 'json', optional: true, shape: purchaseExpenseNotice }
	},
	outputs: { default: { fields: 'all', source: { fields: ['name'] } } },
	constraints: { one_per_period: { unique: ['source', 'period'], import_key: true } },
	create: {
		fields: ['source', 'period', 'currency', 'observed_at', 'entries', 'expense_notice']
	},
	update: {
		fields: ['source', 'period', 'currency', 'observed_at', 'entries', 'expense_notice']
	}
});
