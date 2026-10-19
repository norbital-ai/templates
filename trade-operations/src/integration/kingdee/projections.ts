import { sqlRows } from './sql-rows.js';
/** One feed's SQL: its snapshot and CDC statements, and the columns read as precise text or ISO dates. */
export type Projection = ReturnType<typeof sqlRows> & {
	decimals?: readonly string[];
	dates?: readonly string[];
};
const orderHeaders = (direction: 'sales' | 'purchasing') => {
	const rows = sqlRows(
		'OrderHeader',
		[
			'external_id',
			'order_id',
			'reference',
			'agreement_hash',
			'currency',
			'status',
			'source_updated_at'
		],
		false,
		'external_id',
		true
	);
	return {
		...rows,
		snapshot: rows.snapshot + ` WHERE direction = '${direction}'`,
		changes: rows.changes + ` WHERE delta.direction = '${direction}'`
	};
};
export const projections = {
	credit_snapshots: {
		...sqlRows('credit_snapshots', [
			'external_code',
			'currency',
			'credit_limit',
			'credit_used',
			'credit_hold',
			'as_of',
			'party_code'
		]),
		decimals: ['credit_limit', 'credit_used']
	},
	ext_purchase_orders: orderHeaders('purchasing'),
	ext_sales_orders: orderHeaders('sales'),
	parties: sqlRows(
		'parties',
		[
			'external_code',
			'name',
			'kind',
			'currency',
			'active',
			'address',
			'phone',
			'source_updated_at'
		],
		true
	),
	products: {
		...sqlRows(
			'products',
			[
				'external_code',
				'name',
				'spec',
				'unit',
				'currency',
				'unit_price',
				'tax_rate',
				'active',
				'source_updated_at'
			],
			true
		),
		decimals: ['unit_price', 'tax_rate']
	},
	source_payments: {
		...sqlRows(
			'source_payments',
			[
				'external_code',
				'order_id',
				'invoice_id',
				'kind',
				'reference',
				'settled_on',
				'source_updated_at',
				'seal_hash',
				'currency',
				'amount',
				'active'
			],
			true
		),
		decimals: ['amount'],
		dates: ['settled_on']
	},
	source_sales_lines: {
		...sqlRows(
			'source_sales_lines',
			[
				'external_code',
				'lot_number',
				'unit_cost',
				'order_id',
				'order_line_id',
				'kind',
				'reference',
				'business_on',
				'source_updated_at',
				'seal_hash',
				'unit',
				'quantity',
				'currency',
				'net_amount',
				'tax_amount',
				'freight',
				'active'
			],
			true
		),
		decimals: ['unit_cost', 'quantity', 'net_amount', 'tax_amount', 'freight'],
		dates: ['business_on']
	},
	stock_snapshots: {
		...sqlRows('stock_snapshots', [
			'external_code',
			'lot_number',
			'unit_cost',
			'currency',
			'unit',
			'on_hand',
			'erp_committed',
			'as_of',
			'orders_as_of',
			'product_code',
			'warehouse_code'
		]),
		decimals: ['unit_cost', 'on_hand', 'erp_committed']
	},
	transactions: {
		...sqlRows(
			'OrderTransaction',
			[
				'external_id',
				'parent_id',
				'order_id',
				'direction',
				'kind',
				'reference',
				'seal_hash',
				'currency',
				'status',
				'items',
				'documents',
				'issued_on',
				'due_on',
				'total',
				'source_updated_at'
			],
			false,
			'external_id',
			true
		),
		decimals: ['total'],
		dates: ['issued_on', 'due_on']
	},
	warehouses: sqlRows(
		'warehouses',
		['external_code', 'name', 'group_code', 'active', 'source_updated_at'],
		true
	)
} satisfies Record<string, Projection>;
