<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
</script>

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
		columns={['catalog_code', 'employment_id', 'from', 'to', 'location', 'description']}
	/>
</AppShell>
