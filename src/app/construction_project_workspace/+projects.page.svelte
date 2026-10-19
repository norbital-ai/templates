<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
</script>

<AppShell
	icon="lucide:building-2"
	title={bolt.t('app.construction_project_workspace.title')}
	description={bolt.t('app.construction_project_workspace.description')}
	banner="app-media/construction_project_workspace-banner.webp"
>
	<Table
		of="projects"
		pageSize={50}
		columns={['project_name', 'project_number', 'client', 'status', 'schedule_range']}
	/>
</AppShell>
