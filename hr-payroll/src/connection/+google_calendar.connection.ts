import { connection } from '@norbital-ai/bolt';

/** Google Calendar's API: each entity's public holiday calendar, read by `holiday_import`. */
export default connection({
	baseUrl: 'GOOGLE_CALENDAR_BASE_URL',
	auth: { header: { name: 'X-Goog-Api-Key', value: 'GOOGLE_CALENDAR_API_KEY' } }
});
