import { model } from '@norbital-ai/bolt';
export default model({
	description: 'order lines',
	label: ['product_name', 'quantity'],
	fields: {
		product_code: {
			kind: 'text'
		},
		product_name: {
			kind: 'text'
		},
		unit: {
			kind: 'text'
		},
		currency: {
			kind: 'currency'
		},
		quantity: {
			kind: 'decimal',
			scale: 3,
			min: 0
		},
		unit_price: {
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		discount_pct: {
			kind: 'decimal',
			scale: 2,
			default: 0,
			min: 0,
			max: 100
		},
		tax_rate: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			max: 100
		},
		net: {
			kind: 'money',
			currency: 'currency'
		},
		tax: {
			kind: 'money',
			currency: 'currency'
		},
		total: {
			kind: 'money',
			currency: 'currency'
		},
		floor_net: {
			kind: 'money',
			currency: 'currency',
			scale: 8,
			optional: true
		},
		floor_on: {
			kind: 'date',
			optional: true
		},
		commission_factor: {
			kind: 'decimal',
			scale: 6,
			optional: true,
			min: 0
		},
		commission_basis_unit: {
			kind: 'text',
			optional: true
		}
	},
	check: {
		unit_price_nonnegative: {
			unit_price: {
				gte: '0'
			}
		}
	}
});
