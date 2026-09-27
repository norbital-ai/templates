import { collection } from '@norbital-ai/bolt';

export default collection('notes', { read: { fields: 'all' } });
