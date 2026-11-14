import { workspace } from '@norbital-ai/bolt';
/**
 * An on-demand home-services business in Singapore: customers book a service at their address, a helper with the skill
 * is matched to each visit, and dispatch watches every shift before it starts. Days and working hours are Singapore
 * wall time; money is in Singapore dollars.
 *
 * Customers book on the portal, which a site can embed: they verify their mobile number on the page with a texted code,
 * which signs them up — no invitation — as a `customer` (the portal alone, and only their own records), bound to the
 * customer record with that number. A newcomer passes a bot check first, since each code is a paid text. An administrator
 * can close sign-up in Settings.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	// the warning letter
	convert: { to: ['pdf'] },
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
		party: { model: 'customers', match: { phone: 'phone' } },
		challenge: true
	},
	// rate limits per policy
	limits: {
		customer: { read: '300/min', act: '30/h' },
		dispatch_automation: { act: '600/min', read: '600/min' },
		helper: { act: '120/min', read: '600/min', agent: '50/h' },
		helper_shift: { act: '120/min', read: '600/min' },
		operations: { act: '600/min', read: '600/min', agent: '100/h' },
		portal_visitor: { read: '120/min' }
	}
});
