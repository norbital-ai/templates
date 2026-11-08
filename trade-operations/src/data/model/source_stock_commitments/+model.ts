import { model } from '@norbital-ai/bolt';
import { readStockCommitments } from '../../../integration/kingdee/stock-commitments.js';

export default model('source_stock_commitments', {
	description: 'Open sales quantities by product and warehouse from Kingdee.',
	label: 'observed_at',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		observed_at: { kind: 'instant' },
		entries: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						product_code: { kind: 'text' },
						warehouse: { kind: 'text', optional: true },
						unit: { kind: 'text', optional: true },
						quantity: { kind: 'text' }
					}
				}
			}
		}
	},
	key: ['source'],
	read: {
		source_stock_commitments: { fields: 'all' },
		'source_stock_commitments.source': { fields: ['name'] }
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '5min',
			read: function* ({ instance, cursor }, ctx) {
				return yield* readStockCommitments(instance, cursor, ctx);
			}
		}
	}
});
