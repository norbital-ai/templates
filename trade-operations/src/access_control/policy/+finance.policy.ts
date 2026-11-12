import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Finance manages order-scoped billing and payment evidence.',
	capabilities: { apps: ['operations'] },
	grants: {
		source_lot_costs: {
			outputs: { default: {} }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		ext_sales_orders: {
			outputs: { default: { history: true } }
		},
		ext_purchase_orders: {
			outputs: { default: { history: true } }
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		transactions: {
			outputs: { default: { history: true } }
		},
		commission_statements: {
			outputs: { default: { history: true } },
			create: {}
		},
		source_payments: {
			outputs: { default: { history: true } }
		},
		source_sales_lines: {
			outputs: { default: { history: true } }
		},
		source_receivables: {
			outputs: { default: { history: true } }
		},
		parties: {
			outputs: { default: {} }
		},
		products: {
			outputs: { default: {} }
		},
		warehouses: {
			outputs: { default: {} }
		},
		stock_snapshots: {
			outputs: { default: {} }
		},
		credit_snapshots: {
			outputs: { default: {} }
		},
		commercial_settings: {
			outputs: { default: {} }
		},
		pricing_floors: {
			outputs: { default: { history: true } }
		},
		commission_rules: {
			outputs: { default: {} }
		},
		sys_user: {
			outputs: { default: {} }
		},
		orders: {
			outputs: { default: { history: true } }
		},
		order_lines: {
			outputs: { default: { history: true } }
		},
		order_files: {
			outputs: { default: { history: true } }
		},
		activities: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		},
		contacts: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		}
	}
});
