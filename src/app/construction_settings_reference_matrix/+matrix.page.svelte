<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
</script>

<AppShell
	icon="lucide:grid-3x3"
	title={bolt.t('app.construction_settings_reference_matrix.title')}
	description="Maintain the BIM reference matrix."
	banner="app-media/construction_settings_reference_matrix-banner.webp"
>
	<Table
		of="bim_reference_matrix"
		key="construction_reference_matrix"
		columns={[
			'reference_name',
			'reference_code',
			'category',
			'subcategory',
			'unit_of_measure',
			'rate',
			'embodied_carbon_per_unit',
			'carbon_unit'
		]}
	/>
</AppShell>
