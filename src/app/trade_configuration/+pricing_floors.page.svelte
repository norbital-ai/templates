<script lang="ts">
	import FloorWarning from '../../lib/ui/floor-warning.svelte';
	import { Field, type FormState } from '@norbital-ai/ui';
	import { Grid, AppShell } from '@norbital-ai/ui/layout';
	import CreateTable from '../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
</script>

{#snippet createFloor(form: FormState)}
	<Grid gap="md"
		>{#each ['product', 'currency', 'group_code', 'effective_on', 'unit', 'floor_price', 'tax_inclusive', 'tax_rate', 'minimum_quantity'] as name}<Field
				{name}
			/>{/each}</Grid
	>
	<FloorWarning {form} />
{/snippet}
<AppShell
	icon="lucide:settings"
	title={bolt.t('models.pricing_floors.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
	><CreateTable
		of="pricing_floors"
		createForm={createFloor}
		createFields={[
			'product',
			'currency',
			'group_code',
			'effective_on',
			'unit',
			'floor_price',
			'tax_inclusive',
			'tax_rate',
			'minimum_quantity'
		]}
		columns={[
			'product',
			'group_code',
			'effective_on',
			'currency',
			'floor_price',
			'unit',
			'minimum_quantity'
		]}
	/></AppShell
>
