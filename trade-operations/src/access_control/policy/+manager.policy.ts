import { policy } from '@norbital-ai/bolt';
import { draftOrders, lineDeletes, review } from '../../lib/order-review.js';
export default policy({
	description: 'Commercial manager with both sales and purchasing access.',
	capabilities: { apps: ['operations'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		// order owners, commission salespeople and logistics handlers
		sys_user: { outputs: { default: {} } },
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
			outputs: { default: { history: true } },
			// related_party belongs to Finance; managers maintain partner profile locally and propose credit limit adjustments with Finance approval
			update: {
				fields: [
					'tax_id',
					'bank_name',
					'bank_account',
					'profile_notes',
					'credit_limit_target',
					'credit_days_target'
				],
				verdict: function* (changes, ctx) {
					const creditChanged = changes.some(
						({ before, after }) =>
							before.credit_limit_target !== after.credit_limit_target ||
							before.credit_days_target !== after.credit_days_target
					);
					return creditChanged ? yield* review(ctx, 'finance') : ctx.allow();
				}
			}
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
		credit_releases: {
			outputs: { default: { history: true } },
			update: {
				fields: ['approval_status', 'route', 'proposed_limit', 'reason'],
				verdict: function* (changes, ctx) {
					const invalid = changes.findIndex(
						({ before, after }) =>
							before.source_status !== 'blocked' ||
							before.approval_status !== 'none' ||
							after.approval_status !== 'approved'
					);
					return invalid >= 0
						? yield* ctx.refuse('errors.credit_release_approval_only', { row: invalid })
						: yield* review(ctx, 'finance');
				}
			}
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
		source_payables: {
			outputs: { default: { history: true } }
		},
		source_purchase_orders: {
			outputs: { default: { history: true } }
		},
		source_sales_lines: {
			outputs: { default: { history: true } }
		},
		user_profiles: {
			outputs: { default: { history: true } },
			create: {},
			update: {},
			delete: {}
		}
	}
});
