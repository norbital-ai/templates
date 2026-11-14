import { model } from '@norbital-ai/bolt';
import { logisticsProduct } from '../../../../lib/logistics.js';
export default model('stock_snapshots', {
	description: 'stock snapshots',
	record_label:
		"record.product.name + ' · ' + record.warehouse.name + (record.lot_number != null ? ' · ' + record.lot_number : '')",
	fields: {
		lot_number: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		external_code: {
			kind: 'text'
		},
		unit: {
			kind: 'text',
			optional: true
		},
		on_hand: {
			kind: 'decimal',
			scale: 3
		},
		erp_committed: {
			kind: 'decimal',
			scale: 3,
			optional: true
		},
		as_of: {
			kind: 'instant'
		},
		orders_as_of: {
			kind: 'instant',
			optional: true
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		product: { kind: 'ref', to: 'products' },
		warehouse: { kind: 'ref', to: 'warehouses' }
	},
	outputs: {
		default: { fields: 'all', product: { fields: 'all' }, warehouse: { fields: 'all' } },
		logistics: {
			fields: [
				'lot_number',
				'external_code',
				'unit',
				'on_hand',
				'erp_committed',
				'as_of',
				'orders_as_of',
				'source',
				'product',
				'warehouse'
			],
			product: { fields: logisticsProduct },
			warehouse: { fields: 'all' }
		}
	},
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	// availability names each snapshot's product and warehouse
	indexes: { search: { text: ['product', 'warehouse', 'lot_number', 'external_code'] } },
	create: {
		fields: [
			'lot_number',
			'currency',
			'unit_cost',
			'external_code',
			'unit',
			'on_hand',
			'erp_committed',
			'as_of',
			'orders_as_of',
			'source',
			'product',
			'warehouse'
		]
	},
	update: {
		fields: [
			'lot_number',
			'currency',
			'unit_cost',
			'external_code',
			'unit',
			'on_hand',
			'erp_committed',
			'as_of',
			'orders_as_of',
			'source',
			'product',
			'warehouse'
		]
	},
	delete: {}
});
