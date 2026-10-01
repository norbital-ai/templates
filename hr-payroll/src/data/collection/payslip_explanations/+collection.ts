import { collection } from '@norbital-ai/bolt';

/** Created only through the payslip graph, with its payslip; no direct write. */
export default collection('payslip_explanations', {
	read: { fields: 'all' }
});
