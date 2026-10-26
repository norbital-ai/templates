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
		document_templates: { read: { status: { eq: 'published' } } },
		transactions: { read: true, history: true },
		commission_statements: { read: true, history: true, create: true, queries: ['board'] },
		parties: {
			queries: ['progress'],
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
			queries: ['erp_availability', 'projected_availability'],
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true
		},
		pricing_floors: {
			queries: ['inventory_cost'],
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
			moves: 'all',
			queries: [
				'document_preview',
				'document_versions',
				'confirmation_check',
				'quotation_export',
				'sealed_export',
				'ar_aging',
				'sales_analysis',
				'sales_detail',
				'commission'
			]
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
			queries: ['ledger'],
			history: true,
			read: true
		},
		source_sales_lines: {
			history: true,
			read: true
		}
	}
});
