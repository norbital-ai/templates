<script lang="ts">
	import { collectionClient } from '../collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Cover } from '@norbital-ai/ui/layout';

	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<title>Construction Reference Matrix</title>
	<meta name="description" content="Maintain the BIM reference matrix." />
	<meta name="bolt:icon" content="lucide:grid-3x3" />
	<meta
		name="bolt:thumbnail"
		content="/api/template-seed-assets/construction/app-media/construction_settings_reference_matrix-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/construction/app-media/construction_settings_reference_matrix-banner.webp"
	/>
</svelte:head>

<Cover as="main">
	<Bound size="full" inset>
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
	</Bound>
</Cover>
