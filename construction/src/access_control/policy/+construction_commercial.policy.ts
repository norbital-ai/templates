import { policy } from '@norbital-ai/bolt';

/** Commercial & QS authority: contracts, variations, PO/DO/Invoices/Claims, Costing Matrix, and BIM cost estimations. */
export default policy({
	description:
		'Commercial writes for contracts/variations, PO/DO/invoices/claims, quantifiable costing matrix, and BIM cost estimates.',
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
		cost_estimates: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_matrix: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		contacts: { outputs: { default: {} }, create: {}, update: {} }
	},
	capabilities: {
		automations: ['generate_payment_claim', 'analyze_bim_file']
	}
});
