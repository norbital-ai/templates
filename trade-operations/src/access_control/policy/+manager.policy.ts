import { policy } from '@norbital-ai/bolt';
import { draftOrders, lineDeletes } from '../../lib/order-review.js';
export default policy({
	description: 'Commercial manager with both sales and purchasing access.',
	capabilities: { apps: ['operations'] },
	grants: {
		source_lot_costs: {
			outputs: { default: {} }
		},
		source_stock_commitments: {
			outputs: { default: {} }
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
			create: {}
		},
		parties: {
			outputs: { default: {} }
		},
		products: {
			outputs: { default: {} },
			update: {}
		},
		warehouses: {
			outputs: { default: {} }
		},
		stock_snapshots: {
			outputs: { default: {} }
		},
		credit_snapshots: {
			outputs: { default: {} }
		},
		commercial_settings: {
			outputs: { default: {} }
		},
		pricing_floors: {
			outputs: { default: { history: true } }
		},
		commission_rules: {
			outputs: { default: {} }
		},
		orders: {
			outputs: { default: { history: true } },
			create: {},
			update: { moves: 'all' },
			delete: {
				verdict: function* (changes, ctx) {
					const sealed = draftOrders(changes.map(({ before }) => before));
					return sealed >= 0
						? yield* ctx.refuse('errors.order_sealed', { row: sealed })
						: ctx.allow();
				}
			}
		},
		order_lines: {
			outputs: { default: { history: true } },
			create: {},
			update: {},
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
			create: {}
		},
		activities: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		},
		contacts: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
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
