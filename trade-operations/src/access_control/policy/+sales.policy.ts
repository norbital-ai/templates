import { policy } from '@norbital-ai/bolt';
import { memberOf, ordersIn, ownSales, reviewOrders } from '../../lib/order-review.js';
const own = {
	order: { is: { direction: { eq: 'sales' }, owner: { eq: { var: 'requestor.id' } } } }
} as const;
export default policy({
	description: 'sales commercial work scoped by order.',
	capabilities: {
		apps: ['operations']
	},
	automations: ['orders_revise'],
	grants: {
		ext_sales_orders: {
			read: { ext_sales_orders: { where: own } },
			history: own
		},
		document_templates: {
			read: { document_templates: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			read: { transactions: { where: own } },
			history: own
		},
		commission_statements: {
			read: { commission_statements: { where: { owner: { eq: { var: 'requestor.id' } } } } },
			history: { owner: { eq: { var: 'requestor.id' } } }
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
			// the layers under an own order (its party, lines and documents) are read with it
			read: {
				orders: { where: { direction: { eq: 'sales' }, owner: { eq: { var: 'requestor.id' } } } }
			},
			history: { direction: { eq: 'sales' }, owner: { eq: { var: 'requestor.id' } } },
			create: {
				check: function* (rows, ctx) {
					const away = rows.findIndex(
						(row) =>
							row.direction !== 'sales' || (row.owner !== undefined && row.owner !== memberOf(ctx))
					);
					return away >= 0
						? ctx.deny('errors.sales_scope', { row: away, field: 'direction' })
						: ctx.allow();
				}
			},
			// a confirmation needs a commercial manager; any other edit of an unconfirmed order is direct
			update: {
				check: function* (changes, ctx) {
					return reviewOrders(changes, ctx, ownSales(ctx), 'errors.sales_scope');
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
						ownSales(ctx)
					))
						? ctx.allow()
						: ctx.deny('errors.sales_scope');
				}
			},
			update: {
				check: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: ctx.deny('errors.sales_scope');
				}
			},
			delete: {
				check: function* (rows, ctx) {
					return (yield* ordersIn(
						ctx,
						rows.map((row) => row.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: ctx.deny('errors.sales_scope');
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
						ownSales(ctx)
					))
						? ctx.allow()
						: ctx.deny('errors.sales_scope');
				}
			},
			update: {
				check: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: ctx.deny('errors.sales_scope');
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
