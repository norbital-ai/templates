import { collection } from '@norbital-ai/bolt';

/** Immutable source portions are created with their actual payment event. */
export default collection('payment_allocations', {
	read: { fields: 'all', relations: ['payable_tranche_id'] }
});
