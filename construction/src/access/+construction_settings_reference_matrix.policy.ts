import { policy } from '@norbital-ai/bolt';

/** Opens one app; collection authority is `construction_read`'s. */
export default policy({
	description: 'BIM reference matrix administration.',
	capabilities: { apps: ['construction_settings_reference_matrix'] },
	grants: {}
});
