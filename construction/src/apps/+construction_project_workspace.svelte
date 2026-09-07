<script lang="ts">
	import { collectionClient } from '../collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';

	const { t } = useI18n<TenantI18nKeys>();

	const banner =
		'/__bolt/request/api/template-seed-assets/construction/app-media/construction_project_workspace-banner.webp';
</script>

<AppShell
	icon="lucide:layout-dashboard"
	title="Construction Project Workspace"
	description="Browse construction projects and open project records."
	{banner}
>
	<CollectionTable client={collectionClient} collection="projects" query={{ limit: 50 }}>
		{#snippet columns({ Column })}
			<Column name="project_name" />
			<Column name="project_number" />
			<Column name="client" />
			<Column name="status" />
			<Column name="schedule_range" />
		{/snippet}
	</CollectionTable>
</AppShell>
