import { policy } from '@norbital-ai/bolt';
import { ordersIn, purchasing, reviewOrders } from '../../lib/order-review.js';
const own = { order: { is: { direction: { eq: 'purchasing' } } } } as const;
export default policy({
	description: 'procurement commercial work scoped by order.',
	capabilities: {
		apps: ['operations']
	},
	automations: ['orders_revise'],
	grants: {
		ext_purchase_orders: {
			read: { ext_purchase_orders: { where: own } },
			history: own
		},
		document_templates: {
			read: { document_templates: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			read: { transactions: { where: own } },
			history: own
		},
		parties: {
			read: true
		},
		products: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true
		},
		pricing_floors: {
			history: true,
			read: true
		},
		commission_rules: {
			read: true
		},
		contacts: {
			read: true,
			create: true,
			update: true
		},
		orders: {
			// the layers under a purchasing order (its party, lines and documents) are read with it
			read: { orders: { where: { direction: { eq: 'purchasing' } } } },
			history: { direction: { eq: 'purchasing' } },
			create: {
				check: function* (rows, ctx) {
					const away = rows.findIndex((row) => row.direction !== 'purchasing');
					return away >= 0
						? ctx.deny('errors.purchasing_scope', { row: away, field: 'direction' })
						: ctx.allow();
				}
			},
			// a confirmation needs a commercial manager; any other edit of an unconfirmed order is direct
			update: {
				check: function* (changes, ctx) {
					return reviewOrders(changes, ctx, purchasing, 'errors.purchasing_scope');
				}
			},
			moves: 'all'
		},
		order_lines: {
			read: { order_lines: { where: own } },
			history: own,
			create: {
				check: function* (rows, ctx) {
					return (yield* ordersIn(
						ctx,
						rows.map((row) => row.order),
						purchasing
					))
						? ctx.allow()
						: ctx.deny('errors.purchasing_scope');
				}
			},
			update: {
				check: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						purchasing
					))
						? ctx.allow()
						: ctx.deny('errors.purchasing_scope');
				}
			},
			delete: {
				check: function* (rows, ctx) {
					return (yield* ordersIn(
						ctx,
						rows.map((row) => row.order),
						purchasing
					))
						? ctx.allow()
						: ctx.deny('errors.purchasing_scope');
				}
			}
		},
		activities: {
			read: { activities: { where: own } },
			history: own,
			create: {
				check: function* (rows, ctx) {
					return (yield* ordersIn(
						ctx,
						rows.map((row) => row.order),
						purchasing
					))
						? ctx.allow()
						: ctx.deny('errors.purchasing_scope');
				}
			},
			update: {
				check: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						purchasing
					))
						? ctx.allow()
						: ctx.deny('errors.purchasing_scope');
				}
			}
		},
		source_payments: {
			history: own,
			read: { source_payments: { where: own } }
		},
		source_sales_lines: {
			history: own,
			read: { source_sales_lines: { where: own } }
		}
	}
});
