import { collection } from '@norbital-ai/bolt';

export default collection('adhoc_catalog_entry', {
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
				'label',
				'facts',
				'reference',
				'payslip_id'
			]
		}
	}
});
