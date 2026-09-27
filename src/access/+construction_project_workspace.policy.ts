import { policy } from '@norbital-ai/bolt';

/** Opens one app; collection authority is `construction_read`'s. */
export default policy({
	description: 'Project operations, issues, and commercial readiness.',
	capabilities: { apps: ['construction_project_workspace'] },
	grants: {}
});
