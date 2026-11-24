<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const stints = stintNames(ctx, () => scope.id);
	let creating = $state(false);
</script>

{#snippet who({ value }: { value: unknown })}{stints.of(value)}{/snippet}

<AppShell
	title={ctx.t('app.work_events.title')}
	description={ctx.t('app.work_events.description')}
	icon="lucide:cloud-sun"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}
		<EmptyState title={ctx.t('app.events.empty_scope')} />
	{:else}
		<Table
			{ctx}
			of="work_event"
			key={`work_events-${scope.id}`}
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.work_events.records')
			}}
			columns={[
				'catalog_code',
				{ field: 'employment_id', cell: who },
				'from',
				'to',
				'location',
				'description'
			]}
		/>
	{/if}
</AppShell>
{#if creating && scope.id !== null}
	<Sheet
		open
		on_open_change={(open) => !open && (creating = false)}
		title={ctx.t('app.work_events.title')}
	>
		<RecordShell
			{ctx}
			of="work_event"
			mode="create"
			values={{ entity_id: scope.id }}
			on_done={() => (creating = false)}
		/>
	</Sheet>
{/if}
