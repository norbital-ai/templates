import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { transformEntries } from '../../../../../lib/payroll_engine/services.js';

const c = collection('loan_catalog_entry', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'catalog_id',
				'employment_id',
				'occurred_on',
				'activity',
				'amount',
				'label',
				'facts',
				'reference'
			],
			filled: ['company_id']
		}
	},
	update: {
		input: {
			columns: [
				'catalog_id',
				'occurred_on',
				'activity',
				'amount',
				'label',
				'facts',
				'reference',
				'payslip_id'
			]
		}
	},
	delete: { transform: true }
});
export default c;

// Admission: the class of the version in force on the entry day, the employment's company, and a settled entry locked.
c.transform((inputs, ctx: TransformCtx<'loan_catalog_entry'>) =>
	transformEntries('loan_catalog_entry', inputs, ctx)
);
