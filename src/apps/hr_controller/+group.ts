import { group } from '@norbital-ai/bolt/authoring';

/**
 * Apps are discovered from the files in this directory. Entities is the companies catalogue.
 * Each sibling scopes itself with a Combobox backed by `company-scope.svelte.ts`.
 */
export default group({
	label: 'HR Controller',
	description:
		'Everything the HR team runs for one legal entity: people and their engagements, the roster and the attendance behind a pay period, leave, loans, pay components, and the payroll runs that settle them.',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
