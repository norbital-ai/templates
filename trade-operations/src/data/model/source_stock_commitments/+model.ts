import { model } from '../../../../.norbital/models/source_stock_commitments.ts';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readStockCommitments } from '../../../integration/kingdee/stock-commitments.js';

export default model({
	description: 'Open sales quantities by product and warehouse from Kingdee.',
	record_label: 'record.source.name',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		observed_at: { kind: 'instant' },
		entries: {
			kind: 'json',
			shape: {
				kind: 'object',
				many: true,
				fields: {
					product_code: { kind: 'text' },
					warehouse: { kind: 'text', optional: true },
					unit: { kind: 'text', optional: true },
					quantity: { kind: 'text' }
				}
			}
		}
	},
	outputs: { default: { fields: 'all', source: { fields: ['name'] } } },
	constraints: { one_per_source: { unique: ['source'], import_key: true } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '5min',
			read: function* ({ instance, cursor }, ctx) {
				return fromSource(yield* readStockCommitments(instance, cursor, ctx), instance);
			}
		}
	}
});
