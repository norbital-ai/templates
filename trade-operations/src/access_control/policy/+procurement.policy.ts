import { policy } from '@norbital-ai/bolt';
import { lineDeletes, ordersIn, purchasing, reviewOrders } from '../../lib/order-review.js';
const own = { order: { is: { direction: { eq: 'purchasing' } } } } as const;
export default policy({
	description: 'procurement commercial work scoped by order.',
	capabilities: { apps: ['operations'], automations: ['orders_revise'] },
	grants: {
		source_stock_commitments: {
			outputs: { default: true }
		},
		ext_purchase_orders: {
			outputs: { default: { where: own, history: true } }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { where: own, history: true } }
		},
		parties: {
			outputs: { default: true }
		},
		products: {
			outputs: { default: true }
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
		contacts: {
			outputs: { default: true },
			create: true,
			update: true
		},
		orders: {
			// the layers under a purchasing order (its party, lines and documents) are read with it
			outputs: { default: { where: { direction: { eq: 'purchasing' } }, history: true } },
			create: {
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(({ after }) => after.direction !== 'purchasing');
					return away >= 0
						? yield* ctx.refuse('errors.purchasing_scope', { row: away, field: 'direction' })
						: ctx.allow();
				}
			},
			// Purchase commitments are tracked directly by procurement.
			update: {
				verdict: function* (changes, ctx) {
					return yield* reviewOrders(changes, ctx, purchasing, 'errors.purchasing_scope', false);
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
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
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
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
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
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
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
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					return (yield* ordersIn(
						ctx,
						changes.map((change) => change.before.order),
						purchasing
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.purchasing_scope');
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
