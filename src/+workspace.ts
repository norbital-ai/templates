import { workspace } from '@norbital-ai/bolt';

/** A Singapore trade desk: document numbers and default dates are read in the desk's zone. */
export default workspace({ tz: 'Asia/Singapore', locale: 'en-SG', apps: ['crm', 'crm_purchase'] });
