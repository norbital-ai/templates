import { model } from '../../../../.norbital/models/source_receivables.ts';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { readReceivables } from '../../../integration/kingdee/receivables.js';
import { receivableEntries } from '../../../lib/receivables.js';

export default model({
	description: 'Verified account-wide balances and dated movements for the receivables report.',
	record_label: 'record.source.name',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		currency: { kind: 'currency' },
		observed_at: { kind: 'instant' },
		entries: { kind: 'json', shape: receivableEntries }
	},
	outputs: { default: { fields: 'all', source: { fields: ['name'] } } },
	constraints: { one_per_source: { unique: ['source'], import_key: true } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1h',
			read: function* ({ instance, cursor }, ctx) {
				return fromSource(yield* readReceivables(instance, cursor, ctx), instance);
			}
		}
	}
});
