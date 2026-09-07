<script lang="ts">
	import { collectionClient } from '../collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';

	const { t } = useI18n<TenantI18nKeys>();

	const banner =
		'/__bolt/request/api/template-seed-assets/construction/app-media/construction_settings_reference_matrix-banner.webp';
</script>

<AppShell
	icon="lucide:grid-3x3"
	title="Construction Reference Matrix"
	description="Maintain the BIM reference matrix."
	{banner}
>
	<CollectionTable
		client={collectionClient}
		collection="bim_reference_matrix"
		view="construction_reference_matrix"
	>
		{#snippet columns({ Column })}
			<Column name="reference_name" />
			<Column name="reference_code" />
			<Column name="category" />
			<Column name="subcategory" />
			<Column name="unit_of_measure" />
			<Column name="rate" />
			<Column name="embodied_carbon_per_unit" />
			<Column name="carbon_unit" />
		{/snippet}
	</CollectionTable>
</AppShell>
