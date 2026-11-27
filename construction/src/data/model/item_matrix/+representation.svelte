<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'item_matrix'>; ctx: PageContext } = $props();
	const controller = use_record_controller();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const category = $derived(
		String(controller?.current?.get('category') ?? record?.category ?? 'bim_asset')
	);
	const quantityBasis = $derived(
		String(controller?.current?.get('quantity_basis') ?? record?.quantity_basis ?? 'count')
	);
	const isBimAsset = $derived(category === 'bim_asset');
	const isDerived = $derived(quantityBasis === 'derived');
</script>

<RecordForm {ctx} {view} subtitle={['category', 'discipline', 'unit']}>
	<Section icon="lucide:table-2" first name="rule" title={ctx.t('section.matrix_rate')}>
		<Grid minimum="compact">
			<Field {ctx} name="code" />
			<Field {ctx} name="name" />
			<Field {ctx} name="category" />
			<Field {ctx} name="discipline" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="active" />
		</Grid>
	</Section>

	<Section icon="lucide:calculator" name="pricing" title={ctx.t('section.quantifiable_pricing')}>
		<Grid minimum="compact">
			<Field {ctx} name="unit" />
			<Field {ctx} name="quantity_basis" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="unit_rate" />
			<Field {ctx} name="waste_factor_pct" />
			<Field {ctx} name="carbon_factor" />
			<Field {ctx} name="carbon_stage" />
			<Field {ctx} name="epd_reference" />
			<Field {ctx} name="recycled_content_pct" />
			<Field {ctx} name="rate_basis" />
			<Field {ctx} name="validity" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>

	{#if isDerived}
		<Section icon="lucide:sigma" name="derived" title={ctx.t('section.derived_quantity')}>
			<Grid minimum="compact">
				<Field {ctx} name="derived_from" />
				<Field {ctx} name="ratio" />
				<Field {ctx} name="stands_in_for" />
			</Grid>
		</Section>
	{/if}

	{#if isBimAsset}
		<Section icon="lucide:box" name="matching" title={ctx.t('section.bim_classification_rules')}>
			<Grid minimum="compact">
				<Field {ctx} name="ifc_classes" />
				<Field {ctx} name="match_keywords" />
				<Field {ctx} name="system_services" />
				<Field {ctx} name="topology_mode" />
				<Field {ctx} name="min_size_mm" />
				<Field {ctx} name="max_size_mm" />
				<Field {ctx} name="insulated" />
			</Grid>
		</Section>
	{/if}
</RecordForm>
