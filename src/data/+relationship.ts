import { relationship } from '@norbital-ai/bolt';

/**
 * Every reference of the workspace. Lines are owned by their document: deleted with it and written only while it is
 * a draft. `activities` and `settlements` name exactly one of several documents through an exclusive arc (`regarding`).
 * `owner_id` names the member who owns (or recorded) a document.
 */
export default relationship({
	'products.main_supplier_id': {
		to: 'suppliers',
		inverse: 'products',
		optional: true,
		onDelete: 'setNull'
	},
	'contacts.account_id': { to: 'accounts', inverse: 'contacts' },
	'activities.regarding': { to: ['accounts', 'quotes'], inverse: 'activities' },

	'quotes.account_id': { to: 'accounts', inverse: 'quotes' },
	'quotes.contact_id': { to: 'contacts', inverse: 'quotes', optional: true },
	'quotes.revision_of': { to: 'quotes', inverse: 'revisions', optional: true, onDelete: 'setNull' },
	'quote_lines.quote_id': { to: 'quotes', inverse: 'quote_lines', owned: true },
	'quote_lines.product_id': { to: 'products', inverse: 'quote_lines' },

	'sales_invoices.quote_id': { to: 'quotes', inverse: 'sales_invoices' },
	'sales_invoices.account_id': { to: 'accounts', inverse: 'sales_invoices' },
	'sales_invoice_lines.sales_invoice_id': {
		to: 'sales_invoices',
		inverse: 'sales_invoice_lines',
		owned: true
	},
	'sales_invoice_lines.quote_line_id': { to: 'quote_lines', inverse: 'sales_invoice_lines' },
	'contract_signings.quote_id': { to: 'quotes', inverse: 'contract_signings' },

	'purchase_orders.supplier_id': { to: 'suppliers', inverse: 'purchase_orders' },
	'purchase_order_lines.purchase_order_id': {
		to: 'purchase_orders',
		inverse: 'purchase_order_lines',
		owned: true
	},
	'purchase_order_lines.product_id': { to: 'products', inverse: 'purchase_order_lines' },
	'goods_receipts.purchase_order_id': { to: 'purchase_orders', inverse: 'goods_receipts' },
	'goods_receipt_lines.goods_receipt_id': {
		to: 'goods_receipts',
		inverse: 'goods_receipt_lines',
		owned: true
	},
	'goods_receipt_lines.purchase_order_line_id': {
		to: 'purchase_order_lines',
		inverse: 'goods_receipt_lines'
	},
	'purchase_invoices.purchase_order_id': { to: 'purchase_orders', inverse: 'purchase_invoices' },
	'purchase_invoices.supplier_id': { to: 'suppliers', inverse: 'purchase_invoices' },
	'purchase_invoice_lines.purchase_invoice_id': {
		to: 'purchase_invoices',
		inverse: 'purchase_invoice_lines',
		owned: true
	},
	'purchase_invoice_lines.purchase_order_line_id': {
		to: 'purchase_order_lines',
		inverse: 'purchase_invoice_lines'
	},

	'settlements.regarding': {
		to: ['quotes', 'purchase_orders', 'purchase_invoices'],
		inverse: 'settlements'
	},

	'activities.owner_id': { to: 'sys_user' },
	'quotes.owner_id': { to: 'sys_user' },
	'sales_invoices.owner_id': { to: 'sys_user' },
	'contract_signings.owner_id': { to: 'sys_user' },
	'purchase_orders.owner_id': { to: 'sys_user' },
	'goods_receipts.owner_id': { to: 'sys_user' },
	'purchase_invoices.owner_id': { to: 'sys_user' },
	'settlements.owner_id': { to: 'sys_user' }
});
