import type { Policy } from './$types.js';

/** Opens project delivery. Collection authority is owned by `construction_read`. */
export default {
	description: 'Project operations, issues, and commercial readiness.',
	capabilities: { apps: ['construction_project_workspace'] },
	grants: {}
} satisfies Policy;
