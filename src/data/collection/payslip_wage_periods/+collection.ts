import { collection } from '@norbital-ai/bolt';

/** Created only through the payslip graph; no direct write. */
export default collection('payslip_wage_periods', {
	read: { fields: 'all' }
});
