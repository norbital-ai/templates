import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: { apps: ['operations'] },
	grants: {
		source_stock_commitments: {
			outputs: { default: true }
		},
		ext_sales_orders: {
			outputs: { logistics: { history: true } }
		},
		ext_purchase_orders: {
			outputs: { logistics: { history: true } }
		},
		transactions: {
			outputs: { logistics: { history: true } }
		},
		commercial_settings: {
			outputs: { logistics: true }
		},
		parties: {
			outputs: { default: true }
		},
		warehouses: {
			outputs: { default: true }
		},
		stock_snapshots: {
			outputs: { logistics: true }
		},
		contacts: {
			outputs: { default: true }
		},
		products: {
			outputs: { logistics: true }
		},
		orders: {
			outputs: { logistics: { history: true } }
		},
		order_lines: {
			outputs: { logistics: { history: true } }
		},
		activities: {
			outputs: { default: { history: true } },
			create: true,
			update: true
		}
	}
});
