import type { Policy } from './$types.js';

/**
 * A procurement officer: suppliers, buying documents, and their lines.
 *
 * The buy side is granted here and withheld from the sales representative policy. Bolt policies are
 * collection-scoped, so buy cost stays off the sales surface by absence of grants rather than by
 * column-level masking: `purchase_order_lines` carries the unit cost, and sales has no grant for it.
 *
 * The boundary runs the other way too: there is no quote grant here, so a procurement officer never
 * sees the sell prices or margin of the sales pipeline. The shared product catalogue grants read to
 * both policies — it carries sell prices only, never cost.
 */
export default {
	description:
		'Manages suppliers, purchase orders, and their lines. Does not access the sales pipeline app.',
	capabilities: { apps: ['crm_purchase'] },
	grants: {
		suppliers: {
			read: {},
			create: {},
			update: {}
		},
		purchase_orders: {
			read: {},
			create: {},
			update: {}
		},
		purchase_order_lines: {
			read: {},
			create: {},
			update: {},
			delete: {}
		},
		goods_receipts: {
			read: {},
			create: {}
		},
		goods_receipt_lines: {
			read: {},
			create: {}
		},
		purchase_invoices: {
			read: {},
			create: {},
			update: {}
		},
		purchase_invoice_lines: {
			read: {},
			create: {},
			update: {},
			delete: {}
		}
	},
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
