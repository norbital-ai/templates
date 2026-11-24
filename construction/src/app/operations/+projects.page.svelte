<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:building-2"
	title={ctx.t('app.operations.page_projects')}
	description={ctx.t('app.operations.projects_description')}
	banner="app-media/construction_project_workspace-banner.webp"
>
	<Table
		{ctx}
		of="projects"
		page_size={50}
		toolbar={{ title: false }}
		columns={[
			'project_name',
			'project_number',
			'project_role',
			'client',
			'status',
			'schedule_range',
			'contract_value',
			'open_task_count',
			'open_issue_count',
			'active_contract_count'
		]}
	/>
</AppShell>
