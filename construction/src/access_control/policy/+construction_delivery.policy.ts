import { policy } from '@norbital-ai/bolt';

/** Site and project delivery authority: manage projects, BIM files & revisions, tasks/milestones, BIM-pinned issues, progress logs, changes, contacts, and synced messages. */
export default policy({
	description:
		'Delivery writes for projects, BIM files, tasks, BIM issues, progress updates, change orders, contacts, and coordination messages.',
	grants: {
		projects: { create: {}, update: {} },
		project_files: { create: {}, update: {} },
		tasks: { create: {}, update: {} },
		issues: { create: {}, update: {} },
		change_orders: { create: {}, update: {} },
		progress_updates: { create: {}, update: {} },
		contacts: { create: {}, update: {}, delete: {} },
		project_messages: { create: {}, update: {} }
	},
	capabilities: {
		automations: [
			'sync_messages',
			'classify_messages',
			'extract_project_updates',
			'reclassify_messages'
		]
	}
});
