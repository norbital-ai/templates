import { model } from '@norbital-ai/bolt';
export default model('warehouses', {
	description: 'warehouses',
	record_label: 'record.name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		group_code: {
			kind: 'text',
			optional: true
		},
		group_name: {
			kind: 'text',
			optional: true
		},
		active: {
			kind: 'bool',
			default: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	// the ledger's name and connection: the dashboard judges each ledger's health through its warehouses
	outputs: { default: { fields: 'all', source: { fields: ['name', 'active', 'status'] } } },
	constraints: { source_code: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'external_code', 'group_code', 'group_name'] } },
	create: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'group_code',
			'group_name',
			'active',
			'source_updated_at',
			'source'
		]
	},
	update: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'group_code',
			'group_name',
			'active',
			'source_updated_at',
			'source'
		]
	}
});
