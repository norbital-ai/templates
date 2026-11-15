import { workspace } from '@norbital-ai/bolt';
/** Treasury and purchasing, with Singapore reporting dates. */
export default workspace({ tz: 'Asia/Singapore', locale: 'en-SG', convert: { to: ['pdf'] } });
