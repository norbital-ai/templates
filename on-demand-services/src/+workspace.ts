import { workspace } from '@norbital-ai/bolt';

/**
 * An on-demand home-services business in Singapore: customers book a service at their address, a helper with the skill
 * is matched to each visit, and dispatch watches every shift before it starts. Days and working hours are Singapore
 * wall time; money is in Singapore dollars.
 *
 * Customers sign up with their mobile number and a texted code — no invitation — and land bound to the customer record
 * with that number, so a guest who booked on the portal becomes a registered customer who sees their own visits. An
 * administrator can close sign-up in Settings.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	apps: [
		'scheduler/schedule',
		'scheduler/helpers',
		'scheduler/customers',
		'scheduler/configurations',
		'helper',
		'my_visits',
		'portal'
	],
	signup: {
		via: ['phone'],
		policies: ['customer'],
		party: { collection: 'customers', match: { phone: 'phone' } }
	}
});
