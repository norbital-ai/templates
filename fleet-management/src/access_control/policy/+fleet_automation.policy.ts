import { policy } from '@norbital-ai/bolt';

export default policy({
	description:
		'Background system authority for GPS transponder webhook ingestion, polling, live ETA refresh, and fleet health monitoring.',
	grants: {
		vehicles: { outputs: { default: {} }, update: {} },
		telemetry_pings: { outputs: { default: {} }, create: {} },
		routes: { outputs: { default: {} }, update: { moves: 'all' } },
		fleet_alerts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		geofences: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
