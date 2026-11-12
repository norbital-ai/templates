<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:table-properties"
	title={ctx.t('app.construction_settings_reference_matrix.title')}
	description={ctx.t('app.construction_settings_reference_matrix.description')}
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
