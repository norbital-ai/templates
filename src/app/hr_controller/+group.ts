import { group } from '@norbital-ai/bolt';

/**
 * Everything the HR team runs for one legal entity. Each app scopes itself to an entity, except Settings, which
 * scopes by jurisdiction lineage. `capabilities.apps: ['hr_controller']` reaches every app under this group.
 */
export default group('hr_controller', {
	label: 'app.hr_controller.title',
	description: 'app.hr_controller.description',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
