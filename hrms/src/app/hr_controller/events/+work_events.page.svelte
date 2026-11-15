<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const stints = stintNames(ctx, () => 'all');
</script>

{#snippet who({ value }: { value: unknown })}{stints.of(value)}{/snippet}

<AppShell
	title={ctx.t('app.work_events.title')}
	description={ctx.t('app.work_events.description')}
	icon="lucide:cloud-sun"
>
	<Table
		{ctx}
		of="work_event"
		key="work_events"
		toolbar={{ new: true, title: ctx.t('app.work_events.records') }}
		columns={[
			'catalog_code',
			{ field: 'employment_id', cell: who },
			'from',
			'to',
			'location',
			'description'
		]}
	/>
</AppShell>
