import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: {
		apps: ['operations']
	},
	grants: {
		ext_sales_orders: {
			history: true,
			read: {
				fields: ['id', 'order', 'reference', 'status', 'agreement_hash', 'source_updated_at']
			}
		},
		ext_purchase_orders: {
			history: true,
			read: {
				fields: ['id', 'order', 'reference', 'status', 'agreement_hash', 'source_updated_at']
			}
		},
		transactions: {
			history: true,
			read: {
				fields: ['id', 'order', 'erp_id', 'kind', 'reference', 'status', 'source_updated_at']
			}
		},
		commercial_settings: { read: { fields: ['id', 'code', 'stock_fresh_minutes'] } },
		parties: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			queries: ['erp_availability', 'projected_availability'],
			read: true
		},
		contacts: {
			read: true
		},
		products: {
			read: {
				fields: ['id', 'external_code', 'name', 'spec', 'unit', 'active']
			}
		},
		orders: {
			history: true,
			read: {
				fields: [
					'id',
					'number',
					'title',
					'direction',
					'party',
					'owner',
					'warehouse',
					'status',
					'ordered_on',
					'seal_hash',
					'operational_contracts',
					'sealed_at',
					'party_name'
				]
			}
		},
		order_lines: {
			history: true,
			read: {
				fields: ['id', 'order', 'product', 'product_code', 'product_name', 'unit', 'quantity']
			}
		},
		activities: {
			history: true,
			read: true,
			create: true,
			update: true
		},
		sys_user: {
			read: true,
			fields: ['id', 'name']
		}
	}
});
