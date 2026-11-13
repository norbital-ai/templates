import { workspace } from '@norbital-ai/bolt';
/**
 * A family office's book: holdings, the daily report and the agent that writes it. `tz` is the one place the zone is
 * set: the agent's 08:00 cron and the report's date follow it. The book's base currency is the `portfolio_settings`
 * row's (USD without one).
 */
export default workspace({
	tz: 'America/New_York',
	locale: 'en-US',
	currency: 'USD',
	apps: ['portfolio'],
	/** The daily report's record view is rendered to PDF and sent with its summary. */
	convert: { to: ['pdf'] }
});
