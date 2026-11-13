<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	let creating = $state(false);
</script>

<AppShell
	title={ctx.t('app.obligations.title')}
	description={ctx.t('app.obligations.description')}
	icon="lucide:clipboard-check"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={ctx.t('app.events.empty_scope')} />{:else}<Table
			{ctx}
			of="obligation"
			key="obligations"
			where={{ entity_id: { eq: scope.id } }}
			order_by={{ due_on: 'asc' }}
			toolbar={{ new: () => (creating = true), title: ctx.t('app.obligations.title') }}
			columns={['title', 'employee_id', 'due_on', 'state']}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		on_open_change={(open) => !open && (creating = false)}
		title={ctx.t('v2.create_duty')}
		><RecordShell
			{ctx}
			of="obligation"
			mode="create"
			values={{ entity_id: scope.id }}
			on_done={() => (creating = false)}
		/></Sheet
	>{/if}
