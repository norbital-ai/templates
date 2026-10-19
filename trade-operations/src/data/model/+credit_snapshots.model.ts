import { model } from '@norbital-ai/bolt';
export default model({
	description: 'credit snapshots',
	label: 'external_code',
	fields: {
		external_code: {
			kind: 'text'
		},
		currency: {
			kind: 'currency'
		},
		credit_limit: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		credit_used: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		credit_hold: {
			kind: 'bool',
			default: false
		},
		as_of: {
			kind: 'instant'
		}
	},
	key: ['source', 'external_code']
});
