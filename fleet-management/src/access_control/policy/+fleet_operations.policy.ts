import { policy } from '@norbital-ai/bolt';

export default policy({
	description:
		'Operational dispatch authority: manage vehicles, dispatch and update routes, ingest GPS telemetry pings, resolve alerts, and trigger live ETA or health checks.',
	grants: {
		vehicles: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		telemetry_pings: { outputs: { default: {} }, create: {} },
		routes: { outputs: { default: {} }, create: {}, update: { moves: 'all' }, delete: {} },
		fleet_alerts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } }
	},
	capabilities: {
		automations: ['refresh_route_eta', 'check_fleet_health'],
		syncs: ['telemetry_pings.transponder']
	}
});
