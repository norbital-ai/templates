import { policy } from '@norbital-ai/bolt';

/** Commercial & Quantity Surveying authority: maintain BOQ costings, quotes & revisions, variation orders, and cashflow payment claims. */
export default policy({
	description:
		'Commercial writes for BOQ cost items, quotes & revisions, variation orders, and payment claims/cashflow.',
	grants: {
		projects: {
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
		cost_items: { create: {}, update: {}, delete: {} },
		quotes: { create: {}, update: {} },
		change_orders: { create: {}, update: {} },
		payment_claims: { create: {}, update: {} }
	},
	capabilities: {
		automations: ['generate_payment_claim']
	}
});
