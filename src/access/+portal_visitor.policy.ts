import { policy } from '@norbital-ai/bolt';

/**
 * A signed-out visitor on the booking portal: the active services, and filing a booking request. Nothing else — no
 * helper, visit or customer is visible, and a request is settled by the `portal_intake` run.
 */
export default policy({
	description: 'Portal visitors: see the active services and file a booking request.',
	grants: {
		services: {
			read: {
				where: { active: { eq: true } },
				fields: ['id', 'name', 'duration_minutes', 'price', 'description']
			}
		},
		booking_requests: {
			create: {
				fields: ['name', 'email', 'phone', 'address', 'area', 'service', 'start', 'repeat', 'notes']
			}
		}
	},
	limits: { register: { rate: '10/h', per: 'ip' } }
});
