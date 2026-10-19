import { model } from '@norbital-ai/bolt';
export default model({
	description: 'Payments and refunds for each order.',
	label: 'reference',
	fields: {
		external_code: { kind: 'text' },
		kind: { kind: 'enum', values: ['receipt', 'refund'] },
		reference: { kind: 'text' },
		settled_on: { kind: 'date' },
		source_updated_at: { kind: 'instant' },
		seal_hash: { kind: 'text' },
		currency: { kind: 'currency' },
		amount: { kind: 'money', currency: 'currency' },
		active: { kind: 'bool', default: true }
	},
	key: ['source', 'external_code'],
	unique: [{ fields: ['order', 'reference'], name: 'one_source_receipt_per_order' }]
});
