import { policy } from '@norbital-ai/bolt';
import {
	commercialReview,
	draftOrders,
	floorReview,
	lineDeletes,
	linesOrders,
	memberOf,
	orderFloorLines,
	ordersIn,
	ownSales,
	scopedOrders
} from '../../lib/order-review.js';
const own = {
	order: { is: { direction: { eq: 'sales' }, owner: { eq: { var: 'actor.id' } } } }
} as const;
export default policy({
	description: 'sales commercial work scoped by order.',
	capabilities: { apps: ['operations'] },
	grants: {
		sys_user: {
			outputs: { default: { where: { id: { eq: { var: 'actor.id' } } } } }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { where: own, history: true } }
		},
		commission_statements: {
			outputs: { default: { where: { owner: { eq: { var: 'actor.id' } } }, history: true } }
		},
		parties: {
			outputs: { default: {} }
		},
		settlements: {
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
			outputs: { default: { history: true } },
			create: { fields: ['party', 'name', 'email', 'phone', 'job_title'] },
			// the Kingdee contact changes in Kingdee; only its sync writes it
			update: {
				fields: ['name', 'email', 'phone', 'job_title'],
				verdict: function* (changes, ctx) {
					const row = changes.findIndex(({ before }) => before.primary);
					return row >= 0 ? yield* ctx.refuse('errors.kingdee_contact', { row }) : ctx.allow();
				}
			},
			delete: {
				verdict: function* (changes, ctx) {
					const row = changes.findIndex(({ before }) => before.primary);
					return row >= 0 ? yield* ctx.refuse('errors.kingdee_contact', { row }) : ctx.allow();
				}
			}
		},
		orders: {
			// the layers under an own order (its party, lines and documents) are read with it
			outputs: {
				default: {
					where: { direction: { eq: 'sales' }, owner: { eq: { var: 'actor.id' } } },
					history: true
				}
			},
			create: {
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(
						({ after: row }) =>
							row.direction !== 'sales' || (row.owner !== undefined && row.owner !== memberOf(ctx))
					);
					if (away >= 0)
						return yield* ctx.refuse('errors.sales_scope', { row: away, field: 'direction' });
					const lines = changes.flatMap(({ after }) =>
						(after.lines ?? []).map((line) => ({
							...line,
							order: {
								direction: after.direction,
								currency: after.currency,
								ordered_on: after.ordered_on ?? ctx.today,
								tax_inclusive: after.tax_inclusive ?? false,
								warehouse: after.warehouse ?? null
							}
						}))
					);
					return (yield* floorReview(ctx, lines)) ? ctx.approve(commercialReview) : ctx.allow();
				}
			},
			// an own order's edits and its sync to Kingdee are direct; a line below its floor may need a manager
			update: {
				verdict: function* (changes, ctx) {
					yield* scopedOrders(changes, ctx, ownSales(ctx), 'errors.sales_scope');
					return (yield* floorReview(ctx, yield* orderFloorLines(ctx, changes)))
						? ctx.approve(commercialReview)
						: ctx.allow();
				},
				moves: 'all'
			},
			// an own draft is deleted once a commercial manager agrees
			delete: {
				verdict: function* (changes, ctx) {
					const befores = changes.map(({ before }) => before);
					const away = befores.findIndex((order) => !ownSales(ctx)(order));
					if (away >= 0) return yield* ctx.refuse('errors.sales_scope', { row: away });
					const sealed = draftOrders(befores);
					return sealed >= 0
						? yield* ctx.refuse('errors.order_sealed', { row: sealed })
						: ctx.approve(commercialReview);
				}
			}
		},
		order_lines: {
			outputs: { default: { where: own, history: true } },
			// a line below its floor, or with none, may need a commercial manager (the floor rule)
			create: {
				verdict: function* (changes, ctx) {
					const orders = yield* linesOrders(
						ctx,
						changes.map(({ after }) => after.order)
					);
					if (orders.length !== new Set(changes.map(({ after }) => after.order)).size)
						return yield* ctx.refuse('errors.sales_scope');
					if (!orders.every(ownSales(ctx))) return yield* ctx.refuse('errors.sales_scope');
					const lines = changes.flatMap(({ after }) => {
						const order = orders.find((o) => o.id === after.order);
						return order ? [{ ...after, order }] : [];
					});
					return (yield* floorReview(ctx, lines)) ? ctx.approve(commercialReview) : ctx.allow();
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					const orders = yield* linesOrders(
						ctx,
						changes.map(({ before }) => before.order)
					);
					if (orders.length !== new Set(changes.map(({ before }) => before.order)).size)
						return yield* ctx.refuse('errors.sales_scope');
					if (!orders.every(ownSales(ctx))) return yield* ctx.refuse('errors.sales_scope');
					const lines = changes.flatMap(({ before, after }) => {
						const order = orders.find((o) => o.id === before.order);
						return order ? [{ ...after, order }] : [];
					});
					return (yield* floorReview(ctx, lines)) ? ctx.approve(commercialReview) : ctx.allow();
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
