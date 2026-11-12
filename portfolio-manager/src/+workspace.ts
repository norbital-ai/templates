import { workspace } from '@norbital-ai/bolt';
/** A family office's book: holdings, the daily report and the agent that writes it. */
export default workspace({
	tz: 'America/New_York',
	locale: 'en-US',
	currency: 'USD',
	apps: ['portfolio']
});
