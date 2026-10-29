import { policy } from '@norbital-ai/bolt';
/**
 * Someone on the booking portal who has not verified their number yet: the active services and their open times.
 * Nothing else; verifying signs them up as a `customer`.
 */
export default policy({
	description: 'Portal visitors: the active services and their open times.',
	grants: {
		services: { outputs: { portal: { services: { where: { active: { eq: true } } } } } },
		openings: { outputs: { portal: true } }
	},
	limits: { read: '120/min' }
});
