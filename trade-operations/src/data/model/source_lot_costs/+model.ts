import { model } from '../../../../.norbital/models/source_lot_costs.ts';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockLotCosts } from '../../../integration/kingdee/stock-lot-costs.js';

export default model({
	description: 'Audited purchase receipt cost and first receipt date for on-hand lots.',
	record_label: 'string(record.observed_at)',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		observed_at: { kind: 'instant' },
		currency: { kind: 'currency' },
		entries: {
			kind: 'json',
			shape: {
				kind: 'object',
				many: true,
				fields: {
					product_code: { kind: 'text' },
					lot_number: { kind: 'text' },
					unit: { kind: 'text' },
					received_on: { kind: 'date' },
					received_qty: { kind: 'text' },
					unit_cost: { kind: 'text' }
				}
			}
		}
	},
	outputs: { default: { fields: 'all' } },
	constraints: { one_per_source: { unique: ['source'], import_key: true } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* ({ instance, cursor }, ctx) {
				return fromSource(yield* readStockLotCosts(instance, cursor, ctx), instance);
			}
		}
	}
});
