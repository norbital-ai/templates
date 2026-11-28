import { policy } from '@norbital-ai/bolt';
import { memberOf, ownProfileFields } from '../../lib/order-review.js';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: { apps: ['operations'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		sys_user: {
			outputs: { default: {} }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		transactions: {
			outputs: { logistics: { history: true } }
		},
		credit_releases: {
			outputs: { logistics: { history: true } }
		},
		commercial_settings: {
			outputs: { logistics: {} }
		},
		parties: {
			outputs: { default: {} }
		},
		warehouses: {
			outputs: { default: {} }
		},
		stock_snapshots: {
			outputs: { logistics: {} }
		},
		contacts: {
			outputs: { default: {} }
		},
		products: {
			outputs: { logistics: {} }
		},
		orders: {
			outputs: { logistics: { history: true } }
		},
		order_lines: {
			outputs: { logistics: { history: true } }
		},
		activities: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
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
