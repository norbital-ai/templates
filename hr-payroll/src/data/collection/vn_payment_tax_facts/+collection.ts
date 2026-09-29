import { collection } from '@norbital-ai/bolt';

/** Created only with its actual payment event; direct writes cannot alter frozen withholding evidence. */
export default collection('vn_payment_tax_facts', { read: { fields: 'all' } });
