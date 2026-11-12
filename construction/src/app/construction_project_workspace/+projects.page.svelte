<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:building-2"
	title={ctx.t('app.construction_project_workspace.title')}
	description={ctx.t('app.construction_project_workspace.description')}
	banner="app-media/construction_project_workspace-banner.webp"
>
	<Table
		{ctx}
		of="projects"
		page_size={50}
		columns={['project_name', 'project_number', 'client', 'status', 'schedule_range']}
	/>
</AppShell>
