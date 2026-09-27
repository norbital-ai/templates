import { group } from '@norbital-ai/bolt';

/**
 * Everything the HR team runs for one legal entity. Each app scopes itself to an entity, except Settings, which
 * scopes by jurisdiction lineage. `capabilities.apps: ['hr_controller']` reaches every app under this group.
 */
export default group('hr_controller', {
	label: 'HR Controller',
	description:
		'Everything the HR team runs for one legal entity: people and their engagements, the roster and the attendance behind a pay period, leave, loans, the requests raised against the pay catalogue, and the payroll runs that settle them.',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
