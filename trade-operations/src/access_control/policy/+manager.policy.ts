import { policy } from '@norbital-ai/bolt';
import { draftOrders, lineDeletes } from '../../lib/order-review.js';
export default policy({
	description: 'Commercial manager with both sales and purchasing access.',
	capabilities: { apps: ['operations'] },
	grants: {
		// the Logistics staff an order's logistics handler names
		sys_user: { outputs: { default: { where: { team: { eq: 'logistics' } } } } },
		source_lot_costs: {
			outputs: { default: {} }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		source_purchase_lines: {
			outputs: { default: {} }
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
		settlements: {
			outputs: { default: {} }
		},
		products: {
			outputs: { default: {} },
			// the rest mirrors Kingdee
			update: { fields: ['commission_factor', 'commission_basis_unit'] }
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
