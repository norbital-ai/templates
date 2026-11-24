import { policy } from '@norbital-ai/bolt';

export default policy({
	description:
		'Read-only visibility across fleet vehicles, live telemetry pings, routes, alerts, geofences, and drivers.',
	capabilities: { apps: ['operations'] },
	grants: {
		vehicles: { outputs: { default: {} } },
		telemetry_pings: { outputs: { default: {} } },
		routes: { outputs: { default: {} } },
		fleet_alerts: { outputs: { default: {} } },
		geofences: { outputs: { default: {} } },
		drivers: { outputs: { default: {} } }
	}
});
