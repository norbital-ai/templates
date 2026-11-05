import { integration } from '@norbital-ai/bolt';
/** Drive times for matching and live ETA checks; the account's API key stays sealed. */
export default integration('google_routes', {
	description: 'Google Routes for drive times and traffic.',
	driver: 'http',
	credential: { apiKey: { kind: 'text', label: 'Google Routes API key' } },
	http: {
		baseUrl: 'https://routes.googleapis.com/',
		auth: { header: { name: 'X-Goog-Api-Key', value: 'apiKey' } }
	}
});
