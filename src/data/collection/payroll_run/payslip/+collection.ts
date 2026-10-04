import { collection } from '@norbital-ai/bolt';

export default collection('payslip', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
