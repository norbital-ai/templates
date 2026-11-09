<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	const scope = companyScope();
	let creating = $state(false);
</script>

<AppShell
	title={bolt.t('app.obligations.title')}
	description={bolt.t('app.obligations.description')}
	icon="lucide:clipboard-check"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={bolt.t('app.events.empty_scope')} />{:else}<Table
			of="obligation"
			key="obligations"
			where={{ entity_id: { eq: scope.id } }}
			orderBy={{ due_on: 'asc' }}
			toolbar={{ new: () => (creating = true), title: bolt.t('app.obligations.title') }}
			columns={['title', 'employee_id', 'due_on', 'state']}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		onOpenChange={(open) => !open && (creating = false)}
		title={bolt.t('v2.create_duty')}
		><RecordShell
			of="obligation"
			mode="create"
			values={{ entity_id: scope.id }}
			onDone={() => (creating = false)}
		/></Sheet
	>{/if}
