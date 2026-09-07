import { group } from '@norbital-ai/bolt/authoring';

/**
 * Apps are discovered from the files in this directory. Entities is the companies catalogue.
 * Each sibling scopes itself with a Combobox backed by `company-scope.svelte.ts`, except
 * Settings, which scopes by jurisdiction lineage (`jurisdiction-scope.svelte.ts`): one lineage
 * is shared by every entity bound to it.
 *
 * `events/` is a group of its own under this one — the five request families, one page each. Every
 * policy that names `hr_controller` reaches them, because `capabilities.apps` matches a name or a
 * `<name>/` prefix.
 */
export default group({
	label: 'HR Controller',
	description:
		'Everything the HR team runs for one legal entity: people and their engagements, the roster and the attendance behind a pay period, leave, loans, the requests raised against the pay catalogue, and the payroll runs that settle them.',
	icon: 'lucide:briefcase-business',
	defaultChild: 'people'
});
