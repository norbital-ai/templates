import { model } from '@norbital-ai/bolt';
import { commercialSalesFields } from '../../../../lib/sales-fact-fields.js';

// the sales reports price each line against its order (its party, its lines' products)
const order = {
	fields: 'all',
	party: { fields: 'all' },
	lines: { fields: 'all' }
} as const;
export default model('source_sales_lines', {
	description: 'source_sales_lines',
	record_label: 'record.reference',
	fields: {
		lot_number: { kind: 'text', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		booked_cost: { kind: 'decimal', scale: 10, optional: true },
		booked_cost_currency: { kind: 'currency', optional: true },
		external_code: { kind: 'text' },
		// the order line's id; a line removed later keeps its facts
		order_line: { kind: 'text', hidden: true, optional: true },
		kind: { kind: 'enum', values: ['shipment', 'return', 'invoice_only', 'invoice'] },
		reference: { kind: 'text' },
		business_on: { kind: 'date' },
		source_updated_at: { kind: 'instant' },
		unit: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3 },
		currency: { kind: 'currency' },
		net_amount: { kind: 'money', currency: 'currency', optional: true },
		tax_amount: { kind: 'money', currency: 'currency', optional: true },
		freight: { kind: 'money', currency: 'currency', optional: true },
		active: { kind: 'bool', default: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		order: { kind: 'ref', to: 'orders', inverse: 'source_sales_lines', optional: true },
		source_dimensions: {
			kind: 'json',
			optional: true,
			hidden: true,
			shape: {
				kind: 'object',
				fields: {
					customer: { kind: 'text', optional: true },
					product: { kind: 'text', optional: true },
					employee: { kind: 'text', optional: true },
					employee_id: { kind: 'text', optional: true }
				}
			}
		}
	},
	outputs: {
		default: { fields: 'all', order },
		commercial: { fields: commercialSalesFields, order }
	},
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	create: {
		fields: [
			'lot_number',
			'unit_cost',
			'booked_cost',
			'booked_cost_currency',
			'external_code',
			'order_line',
			'kind',
			'reference',
			'business_on',
			'source_updated_at',
			'unit',
			'quantity',
			'currency',
			'net_amount',
			'tax_amount',
			'freight',
			'active',
			'source',
			'order',
			'source_dimensions'
		]
	},
	update: {
		fields: [
			'lot_number',
			'unit_cost',
			'booked_cost',
			'booked_cost_currency',
			'external_code',
			'order_line',
			'kind',
			'reference',
			'business_on',
			'source_updated_at',
			'unit',
			'quantity',
			'currency',
			'net_amount',
			'tax_amount',
			'freight',
			'active',
			'source',
			'order',
			'source_dimensions'
		]
	}
});
