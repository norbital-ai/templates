import type { Policy } from './$types.js';

/** Opens the BIM reference matrix. Collection authority is owned by `construction_read`. */
export default {
	description: 'BIM reference matrix administration.',
	capabilities: { apps: ['construction_settings_reference_matrix'] },
	grants: {}
} satisfies Policy;
