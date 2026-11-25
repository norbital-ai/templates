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
		toolbar={{
			title: false,
			actions:
				ctx.catalog?.cost_estimates?.update !== undefined
					? [
							{
								icon: 'lucide:sparkles',
								name: ctx.t('bim_costing.sweep_action'),
								description: ctx.t('bim_costing.sweep_action_desc'),
								run: () => ctx.run('sweep_bim_costing', {})
							}
						]
					: []
		}}
		columns={[
			'project_name',
			'project_number',
			'project_role',
			'client_id',
			'status',
			'schedule_range',
			'open_task_count',
			'open_issue_count',
			'active_contract_count'
		]}
	/>
</AppShell>
