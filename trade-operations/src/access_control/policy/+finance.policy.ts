import { policy } from '@norbital-ai/bolt';
import { memberOf, ownProfileFields, review } from '../../lib/order-review.js';
export default policy({
	description: 'Finance manages order-scoped billing and payment evidence.',
	capabilities: { apps: ['operations'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
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
		source_payments: {
			outputs: { default: { history: true } }
		},
		source_sales_lines: {
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
		parties: {
			outputs: { default: { history: true } },
			// the rest mirrors Kingdee; Finance maintains related-party classification & partner profile locally; credit limit target changes require manager review
			update: {
				fields: [
					'related_party',
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
					return creditChanged ? yield* review(ctx, 'manager') : ctx.allow();
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
						: yield* review(ctx, 'manager');
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
		sys_user: {
			outputs: { default: {} }
		},
		orders: {
			outputs: { default: { history: true } }
		},
		order_lines: {
			outputs: { default: { history: true } }
		},
		order_files: {
			outputs: { default: { history: true } }
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
