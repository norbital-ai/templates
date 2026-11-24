import { policy } from '@norbital-ai/bolt';

export default policy({
	description:
		'Isolated configuration authority: manage geofence boundaries and speed limits, driver directory, and GPS transponder / Google Routes connections.',
	capabilities: { apps: ['configuration'] },
	grants: {
		geofences: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		drivers: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		sys_integration: { outputs: { default: {} }, create: {}, update: {}, delete: {} }
	}
});
