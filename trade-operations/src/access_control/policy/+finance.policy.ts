import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Finance manages order-scoped billing and payment evidence.',
	capabilities: {
		apps: ['operations']
	},
	grants: {
		ext_sales_orders: { read: true, history: true },
		ext_purchase_orders: { read: true, history: true },
		document_templates: { read: { status: { eq: 'published' } } },
		transactions: { read: true, history: true },
		commission_statements: { read: true, history: true, create: true, queries: ['board'] },
		source_payments: {
			queries: ['ledger'],
			history: true,
			read: true
		},
		source_sales_lines: { read: true, history: true },
		parties: {
			queries: ['progress'],
			read: true
		},
		products: {
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
			history: true,
			queries: [
				'document_preview',
				'document_versions',
				'sealed_export',
				'ar_aging',
				'sales_analysis',
				'sales_detail',
				'commission'
			]
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
