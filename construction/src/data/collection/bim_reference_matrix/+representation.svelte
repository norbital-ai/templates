<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'bim_reference_matrix'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['reference_code', 'category']}>
	<Section first name="reference" title={t('section.reference')}>
		<Grid minimum="compact">
			<Field name="reference_name" />
			<Field name="reference_code" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<RefField name="project_id" ref="project" />
			{/if}
			<Field name="category" />
			<Field name="subcategory" />
			<Field name="unit_of_measure" />
		</Grid>
	</Section>
	<Section name="rate_and_carbon" title={t('section.rate_and_carbon')}>
		<Grid minimum="compact">
			<Field name="currency" />
			<Field name="rate" />
			<Field name="embodied_carbon_per_unit" />
			<Field name="carbon_unit" />
		</Grid>
	</Section>
	<Section
		name="specification"
		title={t('section.specification')}
		defaultOpen={false}
		summary={record?.['bim_guid'] || record?.['data_source'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="specification" /></Column>
			<Field name="bim_guid" />
			<Field name="data_source" />
		</Grid>
	</Section>
</RecordForm>
