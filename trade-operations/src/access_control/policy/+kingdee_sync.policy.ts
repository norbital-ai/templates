import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'The Kingdee syncs mirror ledger rows.',
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		parties: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		products: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		warehouses: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		stock_snapshots: {
			outputs: { default: {} },
			create: {},
			update: {},
			delete: {}
		},
		credit_snapshots: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_lot_costs: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_stock_commitments: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_receivables: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_sales_lines: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_payments: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		ext_purchase_orders: {
			outputs: { default: {} }
		},
		transactions: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		orders: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		order_lines: {
			outputs: { default: {} },
			create: {},
			update: {},
			delete: {}
		}
	}
});
