import { policy } from '@norbital-ai/bolt';

/**
 * A procurement officer's purchasing surface. Buy cost stays off the sales surface by absence of grants (only
 * `purchase_order_lines` carries it), and there is no quote grant here, so the buy side never sees a sell margin.
 */
export default policy({
	description:
		'Opens the purchasing app and manages purchase orders, receipts, invoices, and their lines.',
	capabilities: { apps: ['crm_purchase'] },
	grants: {
		purchase_orders: {
			read: true,
			create: true,
			update: true,
			moves: 'all',
			queries: ['purchase_matching', 'export_confirmed']
		},
		purchase_order_lines: { read: true, create: true, update: true, delete: true },
		goods_receipts: { read: true, create: true },
		goods_receipt_lines: { read: true, create: true },
		purchase_invoices: { read: true, create: true, update: true, moves: 'all' },
		purchase_invoice_lines: { read: true, create: true, update: true, delete: true }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
