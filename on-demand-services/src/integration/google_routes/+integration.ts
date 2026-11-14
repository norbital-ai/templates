import { integration } from '@norbital-ai/bolt';
/** Drive times for matching and live ETA checks; the account's API key stays sealed. */
export default integration('google_routes', {
	description: 'Google Routes for drive times and traffic.',
	driver: 'http',
	credential: { api_key: { kind: 'text' } },
	http: {
		base_url: 'https://routes.googleapis.com/',
		auth: { header: { name: 'X-Goog-Api-Key', value: 'api_key' } }
	}
});
