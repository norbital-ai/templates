<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:list-checks"
	title={ctx.t('tasks.title')}
	description={ctx.t('tasks.description')}
>
	<Table
		{ctx}
		of="tasks"
		initial_filter={{ status: { eq: 'open' } }}
		order_by={{ due_on: 'asc' }}
		columns={['subject', 'kind', 'company', 'project_id', 'owner', 'due_on', 'status']}
		toolbar={{ title: false }}
	/>
</AppShell>
