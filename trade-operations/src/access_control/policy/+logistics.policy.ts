import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: {
		apps: ['operations']
	},
	grants: {
		ext_sales_orders: { history: true, outputs: { logistics: true } },
		ext_purchase_orders: { history: true, outputs: { logistics: true } },
		transactions: { history: true, outputs: { logistics: true } },
		commercial_settings: { outputs: { logistics: true } },
		parties: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: { outputs: { logistics: true } },
		contacts: {
			read: true
		},
		products: { outputs: { logistics: true } },
		orders: { history: true, outputs: { logistics: true } },
		order_lines: { history: true, outputs: { logistics: true } },
		activities: {
			history: true,
			read: true,
			create: true,
			update: true
		}
	}
});
