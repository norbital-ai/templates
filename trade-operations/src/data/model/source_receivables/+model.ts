import { model } from '@norbital-ai/bolt';
import { readReceivables } from '../../../integration/kingdee/receivables.js';
import { receivableEntries } from '../../../lib/receivables.js';

export default model('source_receivables', {
	description: 'Verified account-wide balances and dated movements for the receivables report.',
	label: 'observed_at',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		currency: { kind: 'currency' },
		observed_at: { kind: 'instant' },
		entries: { kind: 'json', shape: receivableEntries }
	},
	key: ['source'],
	read: {
		source_receivables: { fields: 'all' },
		'source_receivables.source': { fields: ['name'] }
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1h',
			read: function* ({ instance, cursor }, ctx) {
				return yield* readReceivables(instance, cursor, ctx);
			}
		}
	}
});
