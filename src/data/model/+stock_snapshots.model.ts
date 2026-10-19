import { model } from '@norbital-ai/bolt';
export default model({
	description: 'stock snapshots',
	label: 'external_code',
	fields: {
		lot_number: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		external_code: {
			kind: 'text'
		},
		unit: {
			kind: 'text'
		},
		on_hand: {
			kind: 'decimal',
			scale: 3
		},
		erp_committed: {
			kind: 'decimal',
			scale: 3,
			optional: true
		},
		as_of: {
			kind: 'instant'
		},
		orders_as_of: {
			kind: 'instant',
			optional: true
		}
	},
	key: ['source', 'external_code']
});
