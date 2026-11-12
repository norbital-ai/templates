<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'bim_reference_matrix'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {ctx} {view} subtitle={['reference_code', 'category']}>
	<Section icon="lucide:book-marked" first name="reference" title={ctx.t('section.reference')}>
		<Grid minimum="compact">
			<Field {ctx} name="reference_name" />
			<Field {ctx} name="reference_code" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="category" />
			<Field {ctx} name="subcategory" />
			<Field {ctx} name="unit_of_measure" />
		</Grid>
	</Section>
	<Section icon="lucide:leaf" name="rate_and_carbon" title={ctx.t('section.rate_and_carbon')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="rate" />
			<Field {ctx} name="embodied_carbon_per_unit" />
			<Field {ctx} name="carbon_unit" />
		</Grid>
	</Section>
	<Section
		icon="lucide:file-text"
		name="specification"
		title={ctx.t('section.specification')}
		default_open={false}
		summary={record?.['specification'] || record?.['data_source'] || ctx.t('component.not_set')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field {ctx} name="specification" /></Column>
			<Field {ctx} name="bim_guid" />
			<Field {ctx} name="data_source" />
		</Grid>
	</Section>
</RecordForm>
