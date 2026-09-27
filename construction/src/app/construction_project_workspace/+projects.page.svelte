<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
</script>

<AppShell
	icon="lucide:layout-dashboard"
	title={bolt.t('app.construction_project_workspace.title')}
	description="Browse construction projects and open project records."
	banner="app-media/construction_project_workspace-banner.webp"
>
	<Table
		of="projects"
		pageSize={50}
		columns={['project_name', 'project_number', 'client', 'status', 'schedule_range']}
	/>
</AppShell>
