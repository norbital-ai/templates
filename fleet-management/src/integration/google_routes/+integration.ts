import { integration } from '@norbital-ai/bolt';

/** Optional Google Routes integration for live traffic-aware ETA calculations. */
export default integration('google_routes', {
	description: 'Google Routes API for live traffic-aware drive times and route ETAs.',
	driver: 'http',
	credential: { api_key: { kind: 'text' } },
	http: {
		base_url: 'https://routes.googleapis.com',
		auth: { header: { name: 'X-Goog-Api-Key', value: 'api_key' } },
		allow: {
			methods: ['POST'],
			paths: ['/distanceMatrix/**']
		}
	},
	rate: '10/s'
});
