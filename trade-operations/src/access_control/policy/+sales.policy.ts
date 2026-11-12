import { policy } from '@norbital-ai/bolt';
import { lineDeletes, memberOf, ordersIn, ownSales, reviewOrders } from '../../lib/order-review.js';
const own = {
	order: { is: { direction: { eq: 'sales' }, owner: { eq: { var: 'requestor.id' } } } }
} as const;
export default policy({
	description: 'sales commercial work scoped by order.',
	capabilities: { apps: ['operations'], automations: ['orders_revise'] },
	grants: {
		sys_user: {
			outputs: { default: { where: { id: { eq: { var: 'requestor.id' } } } } }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		ext_sales_orders: {
			outputs: { default: { where: own, history: true } }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { where: own, history: true } }
		},
		commission_statements: {
			outputs: { default: { where: { owner: { eq: { var: 'requestor.id' } } }, history: true } }
		},
		parties: {
			outputs: { default: {} }
		},
		products: {
			outputs: { default: {} }
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
		contacts: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		orders: {
			// the layers under an own order (its party, lines and documents) are read with it
			outputs: {
				default: {
					where: { direction: { eq: 'sales' }, owner: { eq: { var: 'requestor.id' } } },
					history: true
				}
			},
			create: {
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(
						({ after: row }) =>
							row.direction !== 'sales' || (row.owner !== undefined && row.owner !== memberOf(ctx))
					);
					return away >= 0
						? yield* ctx.refuse('errors.sales_scope', { row: away, field: 'direction' })
						: ctx.allow();
				}
			},
			// a confirmation needs a commercial manager; any other edit of an unconfirmed order is direct
			update: {
				verdict: function* (changes, ctx) {
					return yield* reviewOrders(changes, ctx, ownSales(ctx), 'errors.sales_scope');
				},
				moves: 'all'
			}
		},
		order_lines: {
			outputs: { default: { where: own, history: true } },
			create: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map(({ after }) => after.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			},
			delete: {
				verdict: function* (changes, ctx) {
					yield* lineDeletes(
						changes.map(({ before }) => before),
						ctx
					);
					return (yield* ordersIn(
						ctx,
						changes.map(({ before }) => before.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			}
		},
		order_files: {
			outputs: { default: { where: own, history: true } },
			create: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map(({ after }) => after.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			}
		},
		activities: {
			outputs: { default: { where: own, history: true } },
			create: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map(({ after }) => after.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						ownSales(ctx)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.sales_scope');
				}
			}
		},
		source_payments: {
			outputs: { default: { where: own, history: true } }
		},
		source_sales_lines: {
			outputs: { commercial: { where: own, history: true } }
		}
	}
});
