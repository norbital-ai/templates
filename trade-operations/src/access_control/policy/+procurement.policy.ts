import { policy } from '@norbital-ai/bolt';
import {
	lineDeletes,
	memberOf,
	ordersIn,
	ownProfileFields,
	purchasing,
	scopedOrders
} from '../../lib/order-review.js';
const own = { order: { is: { direction: { eq: 'purchasing' } } } } as const;
export default policy({
	description: 'procurement commercial work scoped by order.',
	capabilities: { apps: ['operations'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		// order owners and logistics handlers
		sys_user: { outputs: { default: {} } },
		source_stock_commitments: {
			outputs: { default: {} }
		},
		source_purchase_lines: {
			outputs: { default: {} }
		},
		source_purchase_orders: {
			outputs: { default: { history: true } }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { where: own, history: true } }
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
			outputs: { default: {} },
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
			// procurement syncs its own purchase orders to Kingdee
			update: {
				verdict: function* (changes, ctx) {
					return yield* scopedOrders(changes, ctx, purchasing, 'errors.purchasing_scope');
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
		},
		user_profiles: {
			outputs: { default: { where: { user_id: { eq: { var: 'actor.id' } } }, history: true } },
			create: {
				fields: ['user_id', ...ownProfileFields],
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(({ after }) => after.user_id !== memberOf(ctx));
					return away >= 0
						? yield* ctx.refuse('errors.profile_own_only', { row: away, field: 'user_id' })
						: ctx.allow();
				}
			},
			update: {
				fields: [...ownProfileFields],
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(({ before }) => before.user_id !== memberOf(ctx));
					return away >= 0
						? yield* ctx.refuse('errors.profile_own_only', { row: away })
						: ctx.allow();
				}
			}
		}
	}
});
