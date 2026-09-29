import { collection } from '@norbital-ai/bolt';

/** Priced obligations are authored with their parent, before payment; cash cannot rewrite them. */
export default collection('payable_tranches', {
	read: { fields: 'all', relations: ['payment_allocations'] }
});
