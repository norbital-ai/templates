import { policy } from '@norbital-ai/bolt';

/** Commercial & QS authority: contracts, variations, PO/DO/Invoices/Claims, ad-hoc costs, Item Matrix, BIM cost estimation, and comments on tasks. */
export default policy({
	description:
		'Commercial writes for contracts/variations, PO/DO/invoices/claims, ad-hoc costs, quantifiable item matrix, and BIM cost estimation.',
	grants: {
		projects: {
			outputs: { default: {} },
			update: { fields: ['currency', 'bim_takeoff', 'bim_takeoff_views'] }
		},
		contracts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		commercial_documents: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		adhoc_costs: { outputs: { default: {} }, create: {}, update: { moves: 'all' }, delete: {} },
		cost_estimates: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		item_matrix: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		contacts: { outputs: { default: {} }, create: {}, update: {} },
		asset_mappings: { outputs: { default: {} }, update: { fields: ['item_id', 'note'] } },
		// the commercial team comments on tasks; issues and meetings on site are delivery's
		activities: {
			outputs: { default: {} },
			create: {
				verdict: function* (changes, ctx) {
					const row = changes.findIndex(({ after }) => after.kind !== 'comment');
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.comments_only', { row });
				}
			}
		}
	},
	capabilities: {
		automations: ['generate_payment_claim', 'analyze_bim_file']
	}
});
