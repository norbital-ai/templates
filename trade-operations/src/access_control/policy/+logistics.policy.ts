import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: { apps: ['operations'] },
	grants: {
		source_stock_commitments: {
			outputs: { default: {} }
		},
		ext_purchase_orders: {
			outputs: { logistics: { history: true } }
		},
		transactions: {
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
		}
	}
});
