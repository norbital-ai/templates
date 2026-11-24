import { integration } from '@norbital-ai/bolt';

/**
 * GPS transponder telematics gateway (HMAC-SHA256 webhook wake + HTTP polling).
 * Verified webhook deliveries immediately trigger `telemetry_pings.syncs.transponder`, while
 * periodic polling catches any missed fixes automatically.
 */
export default integration('gps_transponder', {
	description:
		'GPS transponder telematics gateway receiving real-time location, speed, heading, ignition, odometer, and fuel pings via signed webhooks and scheduled HTTP polling.',
	driver: 'http',
	configuration: {
		base_url: { kind: 'text', default: 'https://telematics.example.com' },
		poll_path: { kind: 'text', default: '/api/v1/positions' }
	},
	credential: {
		api_key: { kind: 'text' },
		webhook_secret: { kind: 'text' }
	},
	http: {
		base_url: 'base_url',
		auth: { bearer: 'api_key' },
		allow: {
			methods: ['GET'],
			paths: ['/**']
		}
	},
	webhook: {
		verify: { scheme: 'hmac-sha256', secret: 'webhook_secret' }
	},
	rate: '20/s',
	test: function* (ctx) {
		yield* ctx.request({
			method: 'GET',
			path: ctx.configuration.poll_path || '/api/v1/positions',
			output: { kind: 'json' }
		});
	}
});
