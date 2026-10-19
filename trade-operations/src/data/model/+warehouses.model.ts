import { model } from '@norbital-ai/bolt';
export default model({
	description: 'warehouses',
	label: 'name',
	fields: {
		external_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		group_code: {
			kind: 'text'
		},
		active: {
			kind: 'bool',
			default: true
		},
		source_updated_at: {
			kind: 'instant'
		}
	},
	key: ['source', 'external_code']
});
