import { relationship } from '@norbital-ai/bolt';
export default relationship({
	'parties.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'products.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'warehouses.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'stock_snapshots.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'credit_snapshots.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'ext_sales_orders.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'ext_purchase_orders.source': {
		to: 'sys_integration',
		where: { integration: { eq: 'kingdee' } }
	},
	'transactions.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'source_payments.source': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'source_sales_lines.source': {
		to: 'sys_integration',
		where: { integration: { eq: 'kingdee' } }
	},
	'orders.ledger': { to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
	'source_payments.invoice': { to: 'transactions', optional: true },
	'ext_sales_orders.order': { to: 'orders', inverse: 'ext_sales_orders' },
	'ext_purchase_orders.order': { to: 'orders', inverse: 'ext_purchase_orders' },
	'transactions.ext_sales_order': {
		to: 'ext_sales_orders',
		inverse: 'transactions',
		optional: true
	},
	'transactions.ext_purchase_order': {
		to: 'ext_purchase_orders',
		inverse: 'transactions',
		optional: true
	},
	'transactions.order': { to: 'orders', inverse: 'transactions' },
	'commission_statements.owner': { to: 'sys_user' },
	'commission_statements.acknowledged_by': { to: 'sys_user', default: { actor: 'id' } },
	'source_payments.order': { to: 'orders', inverse: 'source_payments' },
	'source_sales_lines.order': { to: 'orders', inverse: 'source_sales_lines' },
	'orders.party': {
		to: 'parties',
		inverse: 'orders'
	},
	'orders.owner': {
		to: 'sys_user',
		default: {
			actor: 'id'
		}
	},
	'orders.warehouse': {
		to: 'warehouses',
		optional: true
	},
	'order_lines.order': {
		to: 'orders',
		inverse: 'lines',
		owned: true
	},
	'order_lines.product': {
		to: 'products'
	},
	'activities.order': {
		to: 'orders',
		inverse: 'activities'
	},
	'activities.owner': {
		to: 'sys_user',
		default: {
			actor: 'id'
		}
	},
	'contacts.party': {
		to: 'parties',
		inverse: 'contacts'
	},
	'pricing_floors.product': {
		to: 'products'
	},
	'credit_snapshots.party': {
		to: 'parties'
	},
	'stock_snapshots.product': {
		to: 'products'
	},
	'stock_snapshots.warehouse': {
		to: 'warehouses'
	}
});
