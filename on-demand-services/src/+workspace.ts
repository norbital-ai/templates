import { workspace } from '@norbital-ai/bolt';

/**
 * An on-demand home-services business in Singapore: customers book a service at their address, a helper with the skill
 * is matched to each visit, and dispatch watches every shift before it starts. Days and working hours are Singapore
 * wall time; money is in Singapore dollars.
 *
 * Customers book on the portal, which a site can embed: they verify their mobile number on the page with a texted code,
 * which signs them up — no invitation — as a `customer` (the portal alone, and only their own records), bound to the
 * customer record with that number. An administrator can close sign-up in Settings.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	// the warning letter
	convert: { to: ['pdf'] },
	env: {
		GOOGLE_MAPS_API_KEY: {
			label: 'Google Maps API key',
			description:
				'A key with the Routes API enabled. Times every planned drive for matching and the ETA check from live traffic. While unset, drives are estimated from straight-line distance.'
		},
		GOOGLE_ROUTES_BASE_URL: {
			label: 'Google Routes API base URL',
			secret: false,
			default: 'https://routes.googleapis.com/'
		}
	},
	apps: [
		'scheduler/schedule',
		'scheduler/helpers',
		'scheduler/customers',
		'scheduler/configurations',
		'helper',
		'portal'
	],
	signup: {
		via: ['phone'],
		policies: ['customer'],
		party: { collection: 'customers', match: { phone: 'phone' } }
	}
});
