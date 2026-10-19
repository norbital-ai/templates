import { model } from '@norbital-ai/bolt';
import { transactionItems, transactionDocuments } from '../../lib/transaction-shapes.js';
export default model({
	description: 'Issued deliveries and invoices against an order agreement.',
	label: 'reference',
	fields: {
		erp_id: { kind: 'text' },
		kind: { kind: 'enum', values: ['invoice', 'delivery'] },
		reference: { kind: 'text' },
		seal_hash: { kind: 'text' },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['issued', 'void'], default: 'issued' },
		items: { kind: 'json', shape: transactionItems, optional: true },
		documents: { kind: 'json', shape: transactionDocuments, optional: true },
		issued_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		total: { kind: 'money', currency: 'currency', optional: true },
		source_updated_at: { kind: 'instant', optional: true }
	},
	key: ['source', 'erp_id']
});
