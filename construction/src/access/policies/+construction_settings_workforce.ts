import type { Policy } from './$types.js';

/** Opens workforce settings. Collection authority is owned by `construction_read`. */
export default {
	description: 'Workforce library and compliance administration.',
	capabilities: { apps: ['construction_settings_workforce'] },
	grants: {}
} satisfies Policy;
