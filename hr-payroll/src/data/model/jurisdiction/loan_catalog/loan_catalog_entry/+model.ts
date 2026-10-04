import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One loan_catalog_entry record.',
	icon: 'lucide:file-text',
	label: 'employment_id',
	fields: {
		employment_id: { kind: 'text', optional: true },
		company_id: { kind: 'text', optional: true },
		catalog_id: { kind: 'text', optional: true },
		reference: { kind: 'text', optional: true },
		occurred_on: { kind: 'text', optional: true },
		values: { kind: 'text', optional: true },
		activity: { kind: 'text', optional: true }
	}
});
