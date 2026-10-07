import { collection } from '@norbital-ai/bolt';

export default collection('claim_catalog_entry', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'catalog_id',
				'employment_id',
				'occurred_on',
				'activity',
				'amount',
				'quantity',
				'incurred_on',
				'due_on',
				'label',
				'facts',
				'reference'
			]
		}
	},
	update: {
		input: {
			columns: [
				'catalog_id',
				'occurred_on',
				'activity',
				'amount',
				'quantity',
				'incurred_on',
				'due_on',
				'label',
				'facts',
				'reference',
				'payslip_id'
			]
		}
	}
});
