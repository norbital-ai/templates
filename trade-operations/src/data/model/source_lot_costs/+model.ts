import { model } from '@norbital-ai/bolt';
import { readStockLotCosts } from '../../../integration/kingdee/stock-lot-costs.js';

export default model('source_lot_costs', {
	description: 'Audited purchase receipt cost and first receipt date for on-hand lots.',
	label: 'observed_at',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		observed_at: { kind: 'instant' },
		currency: { kind: 'currency' },
		entries: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
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
		}
	},
	key: ['source'],
	read: 'all',
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* ({ instance, cursor }, ctx) {
				return yield* readStockLotCosts(instance, cursor, ctx);
			}
		}
	}
});
