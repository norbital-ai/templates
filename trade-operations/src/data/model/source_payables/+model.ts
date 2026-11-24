import { model } from '@norbital-ai/bolt';
import { payableAccruals, payableEntries } from '../../../lib/payables.js';

export default model('source_payables', {
	description:
		'Verified account-wide payable balances, dated settlements and accruals for AP aging.',
	record_label: 'record.source.name',
	fields: {
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		shard: { kind: 'int', default: 0 },
		currency: { kind: 'currency' },
		observed_at: { kind: 'instant' },
		entries: { kind: 'json', shape: payableEntries },
		accruals: { kind: 'json', optional: true, shape: payableAccruals }
	},
	outputs: { default: { fields: 'all', source: { fields: ['name'] } } },
	constraints: { one_per_source: { unique: ['source', 'shard'], import_key: true } },
	create: { fields: ['source', 'shard', 'currency', 'observed_at', 'entries', 'accruals'] },
	update: { fields: ['source', 'shard', 'currency', 'observed_at', 'entries', 'accruals'] }
});
