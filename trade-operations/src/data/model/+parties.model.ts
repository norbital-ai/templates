import { model } from '@norbital-ai/bolt';
export default model({
	description: 'parties',
	label: 'name',
	fields: {
		external_code: {
			kind: 'text'
		},
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
		}
	},
	search: {
		text: ['name', 'external_code']
	},
	key: ['source', 'external_code']
});
