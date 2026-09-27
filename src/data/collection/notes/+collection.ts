import { collection } from '@norbital-ai/bolt';

/** Read-only, as today: the starter notes have no write contract. */
export default collection('notes', { read: { fields: 'all' } });
