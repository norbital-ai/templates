import { policy } from '@norbital-ai/bolt';
import { lineDeletes } from '../../lib/order-review.js';
export default policy({
	description: 'Commercial manager with both sales and purchasing access.',
	capabilities: { apps: ['operations'], automations: ['orders_revise'] },
	grants: {
		source_lot_costs: {
			outputs: { default: true }
		},
		source_stock_commitments: {
			outputs: { default: true }
		},
		ext_sales_orders: {
			outputs: { default: { history: true } }
		},
		ext_purchase_orders: {
			outputs: { default: { history: true } }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { history: true } }
		},
		commission_statements: {
			outputs: { default: { history: true } },
			create: true
		},
		parties: {
			outputs: { default: true }
		},
		products: {
			outputs: { default: true },
			update: true
		},
		warehouses: {
			outputs: { default: true }
		},
		stock_snapshots: {
			outputs: { default: true }
		},
		credit_snapshots: {
			outputs: { default: true }
		},
		commercial_settings: {
			outputs: { default: true }
		},
		pricing_floors: {
			outputs: { default: { history: true } }
		},
		commission_rules: {
			outputs: { default: true }
		},
		orders: {
			outputs: { default: { history: true } },
			create: true,
			update: { moves: 'all' }
		},
		order_lines: {
			outputs: { default: { history: true } },
			create: true,
			update: true,
			delete: {
				verdict: function* (changes, ctx) {
					yield* lineDeletes(
						changes.map(({ before }) => before),
						ctx
					);
					return ctx.allow();
				}
			}
		},
		order_files: {
			outputs: { default: { history: true } },
			create: true
		},
		activities: {
			outputs: { default: { history: true } },
			create: true,
			update: true
		},
		contacts: {
			outputs: { default: { history: true } },
			create: true,
			update: true
		},
		source_payments: {
			outputs: { default: { history: true } }
		},
		source_receivables: {
			outputs: { default: { history: true } }
		},
		source_sales_lines: {
			outputs: { default: { history: true } }
		}
	}
});
