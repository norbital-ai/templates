import { policy } from '@norbital-ai/bolt';
// The price-free fields logistics reads, wherever the record appears (as a model or as another model's layer).
const order = [
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
] as const;
const line = [
	'id',
	'order',
	'product',
	'product_code',
	'product_name',
	'unit',
	'quantity'
] as const;
const receipt = [
	'id',
	'order',
	'reference',
	'status',
	'agreement_hash',
	'source_updated_at'
] as const;
const document = [
	'id',
	'order',
	'erp_id',
	'kind',
	'reference',
	'status',
	'source_updated_at'
] as const;
const product = ['id', 'external_code', 'name', 'spec', 'unit', 'active'] as const;
export default policy({
	description: 'Logistics records delivery and receipt quantities without commercial prices.',
	capabilities: {
		apps: ['operations']
	},
	grants: {
		ext_sales_orders: {
			history: true,
			read: { ext_sales_orders: { fields: receipt } }
		},
		ext_purchase_orders: {
			history: true,
			read: { ext_purchase_orders: { fields: receipt } }
		},
		transactions: {
			history: true,
			read: { transactions: { fields: document }, 'transactions.order': { fields: order } }
		},
		commercial_settings: {
			read: { commercial_settings: { fields: ['id', 'code', 'stock_fresh_minutes'] } }
		},
		parties: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			read: { stock_snapshots: {}, 'stock_snapshots.product': { fields: product } }
		},
		contacts: {
			read: true
		},
		products: {
			read: { products: { fields: product } }
		},
		orders: {
			history: true,
			read: {
				orders: { fields: order },
				'orders.lines': { fields: line },
				'orders.transactions': { fields: document },
				'orders.ext_sales_orders': { fields: receipt }
			}
		},
		order_lines: {
			history: true,
			read: { order_lines: { fields: line } }
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
