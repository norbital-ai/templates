import { group } from '@norbital-ai/bolt';

/**
 * Everything the HR team runs for one legal entity. Operational apps scope themselves to an entity; Settings scopes by jurisdiction lineage.
 * Banks and Formats manage the shared catalogues. `capabilities.apps: ['hr_controller']` reaches every app under this group.
 */
export default group('hr_controller', {
	label: 'app.hr_controller.title',
	description: 'app.hr_controller.description',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
