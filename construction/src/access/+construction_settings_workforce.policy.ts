import { policy } from '@norbital-ai/bolt';

/** Opens one app; collection authority is `construction_read`'s. */
export default policy({
	description: 'Workforce library and compliance administration.',
	capabilities: { apps: ['construction_settings_workforce'] },
	grants: {}
});
