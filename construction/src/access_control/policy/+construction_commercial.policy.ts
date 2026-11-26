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
		bim_settings: { outputs: { default: {} }, create: {}, update: {} },
		sop_rules: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		contacts: { outputs: { default: {} }, create: {}, update: {} },
		asset_mappings: {
			outputs: { default: {} },
			update: {
				fields: ['item_id', 'ifc_class', 'continuity', 'service', 'review_status', 'note']
			}
		},
		// Commercial & QS members log polymorphic activities across projects, tasks, contracts, and business partners.
		activities: { outputs: { default: {} }, create: {}, update: {} }
	},
	capabilities: {
		automations: ['generate_payment_claim', 'analyze_bim_file']
	}
});
