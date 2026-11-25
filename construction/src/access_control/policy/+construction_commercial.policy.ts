import { policy } from '@norbital-ai/bolt';

/** Commercial & QS authority: contracts, variations, PO/DO/Invoices/Claims, ad-hoc costs, Costing Matrix, and BIM cost estimation. */
export default policy({
	description:
		'Commercial writes for contracts/variations, PO/DO/invoices/claims, ad-hoc costs, quantifiable costing matrix, and BIM cost estimation.',
	grants: {
		projects: {
			outputs: { default: {} },
			update: {
				fields: [
					'contract_value',
					'currency',
					'retention_rate',
					'retention_cap_rate',
					'tax_rate',
					'payment_terms_days'
				]
			}
		},
		contracts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		commercial_documents: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		adhoc_costs: { outputs: { default: {} }, create: {}, update: { moves: 'all' }, delete: {} },
		cost_estimates: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_matrix: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		contacts: { outputs: { default: {} }, create: {}, update: {} }
	},
	capabilities: {
		automations: ['generate_payment_claim', 'analyze_bim_file', 'sweep_bim_costing']
	}
});
