import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: { apps: ['operations'] },
	grants: {
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
		}
	}
});
