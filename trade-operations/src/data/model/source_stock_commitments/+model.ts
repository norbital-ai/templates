import { model } from '@norbital-ai/bolt';

export default model('source_stock_commitments', {
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
	create: { fields: ['source', 'observed_at', 'entries'] },
	update: { fields: ['source', 'observed_at', 'entries'] }
});
