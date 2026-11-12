import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Finance manages order-scoped billing and payment evidence.',
	capabilities: { apps: ['operations'] },
	grants: {
		source_lot_costs: {
			outputs: { default: true }
		},
		source_stock_commitments: {
			outputs: { default: true }
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
			create: true
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
			outputs: { default: true }
		},
		products: {
			outputs: { default: true }
		},
		warehouses: {
			outputs: { default: true }
		},
		stock_snapshots: {
			outputs: { default: true }
		},
		credit_snapshots: {
			outputs: { default: true }
		},
		commercial_settings: {
			outputs: { default: true }
		},
		pricing_floors: {
			outputs: { default: { history: true } }
		},
		commission_rules: {
			outputs: { default: true }
		},
		sys_user: {
			outputs: { default: true }
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
			create: true,
			update: true
		},
		contacts: {
			outputs: { default: { history: true } },
			create: true,
			update: true
		}
	}
});
