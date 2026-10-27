import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial manager with both sales and purchasing access.',
	capabilities: {
		apps: ['operations']
	},
	automations: ['orders_revise'],
	grants: {
		ext_sales_orders: { read: true, history: true },
		ext_purchase_orders: { read: true, history: true },
		document_templates: {
			read: { document_templates: { where: { status: { eq: 'published' } } } }
		},
		transactions: { read: true, history: true },
		commission_statements: { read: true, history: true, create: true },
		parties: {
			read: true
		},
		products: {
			update: true,
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
			read: true,
			fields: ['id', 'name']
		},
		orders: {
			read: true,
			history: true,
			create: true,
			update: true,
			moves: 'all'
		},
		order_lines: {
			read: true,
			history: true,
			create: true,
			update: true,
			delete: true
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
		},
		source_payments: {
			history: true,
			read: true
		},
		source_sales_lines: {
			history: true,
			read: true
		}
	}
});
