import { group } from '@norbital-ai/bolt/authoring';

/**
 * Apps are discovered from the files in this directory. Legal-entity choice lives on Entities
 * and is inherited by every sibling through `company-scope.svelte.ts`.
 */
export default group({
	label: 'HR Controller',
	description:
		'Everything the HR team runs for one legal entity: people and their engagements, the roster and the attendance behind a pay period, leave, loans, pay components, and the payroll runs that settle them.',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
