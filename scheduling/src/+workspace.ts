import { workspace } from '@norbital-ai/bolt';

/**
 * Generic service booking, provider scheduling, and route-aware dispatch workspace. Customers book
 * services online or through the desk, qualified providers are matched with travel buffers and
 * load balancing, and dispatch monitors pre-shift check-ins and live arrival ETAs.
 *
 * Customers book on the self-service portal, which any website can embed: verifying a mobile number
 * signs them up as a `customer` (portal access scoped strictly to their own records). An administrator
 * can adjust or close self-signup in Settings.
 */
export default workspace({
	tz: 'UTC',
	locale: 'en',
	languages: ['en', 'zh'],
	currency: 'USD',
	theme: { palette: 'crisp', accent: 'blue', radius: 'default' },
	apps: ['scheduling', 'configuration', 'provider', 'portal'],
	signup: {
		via: ['phone'],
		policies: ['customer'],
		party: { model: 'customers', match: { phone: 'phone' } },
		challenge: true
	},
	limits: {
		customer: { read: '300/min', act: '30/h' },
		dispatch_automation: { act: '600/min', read: '600/min' },
		operations: { act: '600/min', read: '600/min', agent: '100/h' },
		portal_visitor: { read: '120/min' },
		provider: { act: '120/min', read: '600/min', agent: '50/h' },
		provider_shift: { act: '120/min', read: '600/min' }
	}
});
