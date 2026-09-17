import type { Policy } from './$types.js';

/**
 * The authority the line roll-up automations act under.
 *
 * Held by no team: it exists so a line change can re-total its document as the workspace rather
 * than as whoever wrote the line — `sales_rep` may only edit its own quotes, and a roll-up is not
 * an edit anyone owns. The mask keeps it to the three totals; nothing else on a document is a
 * sum of its lines.
 */
export default {
	description: 'Reads document lines and writes the document net, tax and gross they sum to.',
	grants: {
		quotes: { read: {}, mutate: { existing: { fields: ['net', 'tax', 'gross'] } } },
		quote_lines: { read: {} },
		sales_invoices: { read: {}, mutate: { existing: { fields: ['net', 'tax', 'gross'] } } },
		sales_invoice_lines: { read: {} },
		purchase_orders: { read: {}, mutate: { existing: { fields: ['net', 'tax', 'gross'] } } },
		purchase_order_lines: { read: {} },
		purchase_invoices: { read: {}, mutate: { existing: { fields: ['net', 'tax', 'gross'] } } },
		purchase_invoice_lines: { read: {} }
	}
} satisfies Policy;
