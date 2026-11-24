import { model } from '@norbital-ai/bolt';
export default model('parties', {
	description: 'parties',
	record_label: 'record.name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['customer', 'supplier', 'both']
		},
		currency: {
			kind: 'currency'
		},
		active: {
			kind: 'bool',
			default: true
		},
		region: {
			kind: 'text',
			optional: true
		},
		// workspace-owned classification (never written by Kingdee): related party vs third party
		related_party: {
			kind: 'bool',
			default: false
		},
		address: {
			kind: 'text',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' } },
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'external_code'] } },
	create: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'kind',
			'currency',
			'active',
			'region',
			'address',
			'phone',
			'source_updated_at',
			'source'
		]
	},
	update: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'kind',
			'currency',
			'active',
			'region',
			'related_party',
			'address',
			'phone',
			'source_updated_at',
			'source'
		]
	}
});
