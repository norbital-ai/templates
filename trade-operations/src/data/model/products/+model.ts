import { model } from '@norbital-ai/bolt';
import { logisticsProduct } from '../../../lib/logistics.js';
export default model('products', {
	description: 'products',
	record_label: 'record.name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		spec: {
			kind: 'text',
			optional: true
		},
		producing_area: { kind: 'text', optional: true },
		brand: { kind: 'text', optional: true },
		brand_en: { kind: 'text', optional: true },
		unit: {
			kind: 'text',
			optional: true
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
			optional: true,
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
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' }, logistics: { fields: logisticsProduct } },
	constraints: {
		natural_key: { unique: ['source', 'external_code'], import_key: true },
		unit_price_nonnegative: {
			check: {
				or: [
					{
						unit_price: {
							is_null: true
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
	},
	indexes: { search: { text: ['name', 'external_code'] } },
	update: { fields: ['commission_factor', 'commission_basis_unit'] }
});
