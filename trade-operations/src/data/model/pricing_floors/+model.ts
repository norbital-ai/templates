import { model } from '@norbital-ai/bolt';

export default model('pricing_floors', {
	description: 'pricing floors',
	label: ['effective_on', 'group_code'],
	fields: {
		product: { kind: 'ref', to: 'products' },
		currency: {
			kind: 'currency'
		},
		group_code: {
			kind: 'text'
		},
		effective_on: {
			kind: 'date'
		},
		unit: {
			kind: 'text'
		},
		floor_price: {
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		tax_inclusive: {
			kind: 'bool'
		},
		tax_rate: {
			kind: 'decimal',
			scale: 2,
			default: 0,
			min: 0,
			max: 100
		},
		minimum_quantity: {
			kind: 'decimal',
			scale: 3,
			default: 0,
			min: 0
		}
	},
	key: ['product', 'group_code', 'currency', 'effective_on', 'minimum_quantity'],
	check: {
		floor_price_nonnegative: {
			floor_price: {
				gte: '0'
			}
		}
	},
	read: 'all',
	create: {
		columns: {
			pricing_floors: [
				'product',
				'currency',
				'group_code',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'minimum_quantity'
			]
		}
	},
	update: {
		columns: { pricing_floors: ['floor_price', 'tax_inclusive', 'tax_rate'] }
	}
});
