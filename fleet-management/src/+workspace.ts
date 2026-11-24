import { workspace } from '@norbital-ai/bolt';

/**
 * Real-time fleet management workspace tracking GPS transponder locations, speeds, headings,
 * dispatched routes, destinations, ETAs, geofences, and operational alerts with isolated configuration.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	languages: ['en', 'zh'],
	currency: 'SGD',
	theme: { palette: 'crisp', accent: 'blue', radius: 'default' },
	apps: ['operations', 'configuration'],
	limits: {
		fleet_read: { act: '600/min', read: '600/min', agent: '100/h' }
	}
});
