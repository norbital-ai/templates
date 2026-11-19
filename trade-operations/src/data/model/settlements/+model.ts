import { model } from '@norbital-ai/bolt';
// Kingdee's settlement methods (结算方式), mirrored read-only: an order's payment terms name one
export default model('settlements', {
	description: 'settlement methods',
	record_label: 'record.name',
	fields: {
		external_code: { kind: 'text' },
		code: { kind: 'text' },
		name: { kind: 'text' },
		active: { kind: 'bool', default: true },
		source_updated_at: { kind: 'instant' },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' } },
	constraints: { source_code: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'code'] } },
	create: { fields: ['external_code', 'code', 'name', 'active', 'source_updated_at', 'source'] },
	update: { fields: ['external_code', 'code', 'name', 'active', 'source_updated_at', 'source'] }
});
