import { collection } from '@norbital-ai/bolt';

/** Repayments are written through their loan; only the direct delete is exposed (a pinned repayment is refused by the grant). */
export default collection('loan_repayments', {
	read: { fields: 'all' },
	delete: {}
});
