import { workspace } from '@norbital-ai/bolt';

/**
 * A Singapore trade desk: document numbers and default dates are read in the desk's zone; catalogue prices are in its
 * currency.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	apps: ['crm', 'crm_purchase']
});
