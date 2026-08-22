import { cascade } from '@norbital-ai/bolt/authoring';
import type { Relationships } from './$types.js';

export default ((r) => ({
	accounts: {
		account_contacts: r.many.contacts(),
		account_quotes: r.many.quotes()
	},
	contacts: {
		contact_account: r.one.accounts({
			from: r.contacts.account_id,
			to: r.accounts.id
		}),
		contact_quotes: r.many.quotes()
	},
	products: {
		product_quote_lines: r.many.quote_lines(),
		product_main_supplier: r.one.suppliers({
			from: r.products.main_supplier_id,
			to: r.suppliers.id
		})
	},
	quotes: {
		quote_account: r.one.accounts({
			from: r.quotes.account_id,
			to: r.accounts.id
		}),
		quote_contact: r.one.contacts({
			from: r.quotes.contact_id,
			to: r.contacts.id
		}),
		quote_owner: r.one.user({
			from: r.quotes.owner_id,
			to: r.user.id
		}),
		quote_lines_rel: r.many.quote_lines(),
		quote_sales_invoices: r.many.sales_invoices(),
		quote_contract_signings: r.many.contract_signings(),
		quote_revision_of: r.one.quotes({
			from: r.quotes.revision_of,
			to: r.quotes.id
		})
	},
	quote_lines: {
		// A line has no meaning without its quote, so the database removes it with the quote rather
		// than leaving rows that only a cleanup script would ever find.
		quote_line_quote: cascade(
			r.one.quotes({
				from: r.quote_lines.quote_id,
				to: r.quotes.id
			})
		),
		quote_line_product: r.one.products({
			from: r.quote_lines.product_id,
			to: r.products.id
		})
	},
	activities: {
		activity_owner: r.one.user({
			from: r.activities.owner_id,
			to: r.user.id
		})
	},
	suppliers: {
		supplier_purchase_orders: r.many.purchase_orders(),
		supplier_products: r.many.products()
	},
	purchase_orders: {
		purchase_order_supplier: r.one.suppliers({
			from: r.purchase_orders.supplier_id,
			to: r.suppliers.id
		}),
		purchase_order_owner: r.one.user({
			from: r.purchase_orders.owner_id,
			to: r.user.id
		}),
		purchase_order_lines_rel: r.many.purchase_order_lines(),
		purchase_order_goods_receipts: r.many.goods_receipts(),
		purchase_order_invoices: r.many.purchase_invoices()
	},
	purchase_order_lines: {
		// A line has no meaning without its order, so the database removes it with the order rather
		// than leaving rows that only a cleanup script would ever find.
		purchase_order_line_order: cascade(
			r.one.purchase_orders({
				from: r.purchase_order_lines.purchase_order_id,
				to: r.purchase_orders.id
			})
		),
		purchase_order_line_product: r.one.products({
			from: r.purchase_order_lines.product_id,
			to: r.products.id
		})
	},
	goods_receipts: {
		goods_receipt_order: r.one.purchase_orders({
			from: r.goods_receipts.purchase_order_id,
			to: r.purchase_orders.id
		}),
		goods_receipt_owner: r.one.user({
			from: r.goods_receipts.owner_id,
			to: r.user.id
		}),
		goods_receipt_lines_rel: r.many.goods_receipt_lines()
	},
	goods_receipt_lines: {
		goods_receipt_line_receipt: cascade(
			r.one.goods_receipts({
				from: r.goods_receipt_lines.goods_receipt_id,
				to: r.goods_receipts.id
			})
		),
		goods_receipt_line_order_line: r.one.purchase_order_lines({
			from: r.goods_receipt_lines.purchase_order_line_id,
			to: r.purchase_order_lines.id
		})
	},
	purchase_invoices: {
		purchase_invoice_order: r.one.purchase_orders({
			from: r.purchase_invoices.purchase_order_id,
			to: r.purchase_orders.id
		}),
		purchase_invoice_supplier: r.one.suppliers({
			from: r.purchase_invoices.supplier_id,
			to: r.suppliers.id
		}),
		purchase_invoice_owner: r.one.user({
			from: r.purchase_invoices.owner_id,
			to: r.user.id
		}),
		purchase_invoice_lines_rel: r.many.purchase_invoice_lines()
	},
	purchase_invoice_lines: {
		purchase_invoice_line_invoice: cascade(
			r.one.purchase_invoices({
				from: r.purchase_invoice_lines.purchase_invoice_id,
				to: r.purchase_invoices.id
			})
		),
		purchase_invoice_line_order_line: r.one.purchase_order_lines({
			from: r.purchase_invoice_lines.purchase_order_line_id,
			to: r.purchase_order_lines.id
		})
	},
	sales_invoices: {
		sales_invoice_quote: r.one.quotes({
			from: r.sales_invoices.quote_id,
			to: r.quotes.id
		}),
		sales_invoice_account: r.one.accounts({
			from: r.sales_invoices.account_id,
			to: r.accounts.id
		}),
		sales_invoice_owner: r.one.user({
			from: r.sales_invoices.owner_id,
			to: r.user.id
		}),
		sales_invoice_lines_rel: r.many.sales_invoice_lines()
	},
	sales_invoice_lines: {
		sales_invoice_line_invoice: cascade(
			r.one.sales_invoices({
				from: r.sales_invoice_lines.sales_invoice_id,
				to: r.sales_invoices.id
			})
		),
		sales_invoice_line_quote_line: r.one.quote_lines({
			from: r.sales_invoice_lines.quote_line_id,
			to: r.quote_lines.id
		})
	},
	contract_signings: {
		contract_signing_quote: r.one.quotes({
			from: r.contract_signings.quote_id,
			to: r.quotes.id
		}),
		contract_signing_owner: r.one.user({
			from: r.contract_signings.owner_id,
			to: r.user.id
		})
	}
})) satisfies Relationships;
