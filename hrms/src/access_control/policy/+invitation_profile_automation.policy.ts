import { policy } from '@norbital-ai/bolt';

export default policy({
	description: 'Create employee profiles for staff invitations and link them when members join.',
	grants: {
		sys_invitation: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } },
		employee_profile: {
			outputs: { default: {} },
			create: {
				fields: ['name', 'email', 'phone', 'invitation_id', 'user_id']
			},
			update: { fields: ['invitation_id', 'user_id'] }
		}
	}
});
