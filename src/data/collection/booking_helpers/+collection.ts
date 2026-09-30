import { collection } from '@norbital-ai/bolt';

/** Written with its booking; read on its own by the booking view. */
export default collection('booking_helpers', { read: { fields: 'all' } });
