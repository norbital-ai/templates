import { policy } from '@norbital-ai/bolt';

/** Calendar activity projection can cancel/reinstate meetings without broad workflow transition authority. */
export default policy({
	description: 'Registers calendar appointments under their matched clients and jobs.',
	grants: {
		companies: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } },
		// a synced meeting names its Google Calendar account (`calendar_account`): the ref must be readable
		sys_integration: { outputs: { default: {} } },
		calendar_entries: { outputs: { default: {} } },
		contacts: { outputs: { crm: {} } },
		projects: { outputs: { default: {} } },
		activities: {
			outputs: { default: {} },
			create: {},
			update: { moves: { status: ['open->cancelled', 'cancelled->open'] } }
		}
	}
});
