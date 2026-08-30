import type { Policy } from './$types.js';

/**
 * A procurement officer's purchasing surface and document authority.
 *
 * The buy side is granted here and withheld from the sales representative policy. Bolt policies are
 * collection-scoped, so buy cost stays off the sales surface by absence of grants rather than by
 * column-level masking: `purchase_order_lines` carries the unit cost, and sales has no grant for it.
 *
 * The boundary runs the other way too: there is no quote grant here, so a procurement officer never
 * sees the sell prices or margin of the sales pipeline. `products_read` opens the shared catalogue
 * to both sides — it carries sell prices only, never cost — while `suppliers_manage` owns the
 * supplier master these documents reference.
 */
export default {
	description:
		'Opens the purchasing app and manages purchase orders, receipts, invoices, and their lines.',
	capabilities: { apps: ['crm_purchase'] },
	grants: {
		purchase_orders: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			}
		},
		purchase_order_lines: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			},
			delete: {}
		},
		goods_receipts: {
			read: {},
			mutate: { new: {} }
		},
		goods_receipt_lines: {
			read: {},
			mutate: { new: {} }
		},
		purchase_invoices: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			}
		},
		purchase_invoice_lines: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			},
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
