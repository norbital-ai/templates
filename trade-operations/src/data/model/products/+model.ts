import { model } from '../../../../.norbital/models/products.ts';
import { logisticsProduct } from '../../../lib/logistics.js';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';
export default model({
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
	update: { columns: { fields: ['commission_factor', 'commission_basis_unit'] } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return fromSource(
					yield* readSource(
						projections.products,
						cursor,
						ctx,
						(row) => {
							const r = columns(row);
							return {
								external_code: r.text('external_code'),
								source_number: r.text('source_number', null),
								name: r.text('name'),
								spec: r.text('spec', null),
								producing_area: r.text('producing_area', null),
								brand: r.text('brand', null),
								brand_en: r.text('brand_en', null),
								unit: r.text('unit', null),
								currency: r.currency('currency'),
								unit_price: r.decimal('unit_price', null),
								tax_rate: r.decimal('tax_rate', null),
								active: r.bool('active', true),
								source_updated_at: r.instant('source_updated_at')
							};
						},
						preserveSource({ model: 'products', instance, projection: projections.products, ctx })
					),
					instance
				);
			}
		}
	}
});
