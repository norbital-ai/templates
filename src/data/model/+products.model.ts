import { model } from '@norbital-ai/bolt';
export default model({
	description: 'products',
	label: 'name',
	fields: {
		external_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		spec: {
			kind: 'text',
			optional: true
		},
		unit: {
			kind: 'text'
		},
		currency: {
			kind: 'currency'
		},
		unit_price: {
			kind: 'money',
			currency: 'currency',
			scale: 4,
			optional: true
		},
		tax_rate: {
			kind: 'decimal',
			scale: 2,
			default: 0,
			min: 0,
			max: 100
		},
		commission_factor: {
			kind: 'decimal',
			scale: 6,
			optional: true,
			min: 0
		},
		active: {
			kind: 'bool',
			default: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		commission_basis_unit: {
			kind: 'text',
			optional: true
		}
	},
	search: {
		text: ['name', 'external_code']
	},
	key: ['source', 'external_code'],
	check: {
		unit_price_nonnegative: {
			or: [
				{
					unit_price: {
						isNull: true
					}
				},
				{
					unit_price: {
						gte: '0'
					}
				}
			]
		}
	}
});
