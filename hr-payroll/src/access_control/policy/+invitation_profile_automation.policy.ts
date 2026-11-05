import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description: 'Create employee profiles for staff invitations and link them when members join.',
	grants: {
		sys_invitation: { read: true },
		sys_user: { read: true },
		employee_profile: {
			read: true,
			create: {
				columns: { employee_profile: ['name', 'email', 'phone', 'invitation_id', 'user_id'] }
			},
			update: { columns: { employee_profile: ['invitation_id', 'user_id'] } }
		}
	},
	limits: AUTOMATION_LIMITS
});
