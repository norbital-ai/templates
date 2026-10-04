import { collection } from '@norbital-ai/bolt';

export default collection('payroll_run', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
