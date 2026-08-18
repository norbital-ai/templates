<script lang="ts">
	import { collectionClient } from '../collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Cover } from '@norbital-ai/ui/layout';

	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<title>Construction Project Workspace</title>
	<meta name="description" content="Browse construction projects and open project records." />
	<meta name="pod:icon" content="lucide:layout-dashboard" />
	<meta
		name="pod:thumbnail"
		content="/api/template-seed-assets/construction/app-media/construction_project_workspace-banner.webp"
	/>
	<meta
		name="pod:banner"
		content="/api/template-seed-assets/construction/app-media/construction_project_workspace-banner.webp"
	/>
</svelte:head>

<Cover as="main">
	<Bound size="full" inset>
		<CollectionTable client={collectionClient} collection="projects" query={{ limit: 50 }}>
			{#snippet columns({ Column })}
				<Column name="project_name" />
				<Column name="project_number" />
				<Column name="client" />
				<Column name="status" />
				<Column name="schedule_range" />
			{/snippet}
		</CollectionTable>
	</Bound>
</Cover>
