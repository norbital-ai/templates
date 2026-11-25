import { policy } from '@norbital-ai/bolt';

/** Unauthenticated booking portal visitors: active services and published open start times only. */
export default policy({
	description: 'Portal visitors: active services and published open start times.',
	grants: {
		services: { outputs: { portal: { where: { active: { eq: true } } } } },
		openings: { outputs: { portal: {} } }
	}
});
