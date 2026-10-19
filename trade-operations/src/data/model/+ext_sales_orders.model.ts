import { model } from '@norbital-ai/bolt';
export default model({
	description: 'Customer order confirmation.',
	label: 'reference',
	fields: {
		external_id: { kind: 'text' },
		reference: { kind: 'text' },
		agreement_hash: { kind: 'text', hidden: true },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['draft', 'issued', 'void'] },
		source_updated_at: { kind: 'instant', optional: true }
	},
	key: ['source', 'external_id']
});
