import { model } from '../../../../../.norbital/models/source_sales_lines.ts';
import { fromSource } from '../../../../integration/kingdee/polling.js';
import { readSalesFactSource } from '../../../../integration/kingdee/financial-source.js';
import { readInvoiceAnalysis } from '../../../../integration/kingdee/invoice-analysis.js';
import { commercialSalesFields } from '../../../../lib/sales-fact-fields.js';

const order = {
	fields: 'all',
	party: { fields: 'all' },
	lines: { fields: 'all' }
} as const;
export default model({
	description: 'source_sales_lines',
	record_label: 'record.reference',
	fields: {
		lot_number: { kind: 'text', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		booked_cost: { kind: 'decimal', scale: 10, optional: true },
		booked_cost_currency: { kind: 'currency', optional: true },
		external_code: { kind: 'text' },
		// The approved snapshot owns this identity; an editable draft row may be removed.
		order_line: { kind: 'text', hidden: true, optional: true },
		kind: { kind: 'enum', values: ['shipment', 'return', 'invoice_only', 'invoice'] },
		reference: { kind: 'text' },
		business_on: { kind: 'date' },
		source_updated_at: { kind: 'instant' },
		seal_hash: { kind: 'text', hidden: true, optional: true },
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
	// the sales reports price each line against its order's seal (its party, its lines' products)
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* ({ cursor, instance }, ctx) {
				return fromSource(yield* readSalesFactSource(instance, cursor, ctx), instance);
			}
		},
		invoice_only: {
			with: 'kingdee',
			read: function* ({ cursor, instance }, ctx) {
				return fromSource(yield* readInvoiceAnalysis(instance, cursor, ctx), instance);
			}
		}
	}
});
