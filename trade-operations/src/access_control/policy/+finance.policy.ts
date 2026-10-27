import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Finance manages order-scoped billing and payment evidence.',
	capabilities: {
		apps: ['operations']
	},
	grants: {
		ext_sales_orders: { read: true, history: true },
		ext_purchase_orders: { read: true, history: true },
		document_templates: {
			read: { document_templates: { where: { status: { eq: 'published' } } } }
		},
		transactions: { read: true, history: true },
		commission_statements: { read: true, history: true, create: true },
		source_payments: {
			history: true,
			read: true
		},
		source_sales_lines: { read: true, history: true },
		parties: {
			read: true
		},
		products: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true
		},
		pricing_floors: {
			history: true,
			read: true
		},
		commission_rules: {
			read: true
		},
		sys_user: {
			read: true
		},
		orders: {
			read: true,
			history: true
		},
		order_lines: {
			read: true,
			history: true
		},
		activities: {
			read: true,
			history: true,
			create: true,
			update: true
		},
		contacts: {
			read: true,
			history: true,
			create: true,
			update: true
		}
	}
});
