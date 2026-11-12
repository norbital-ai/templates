<script lang="ts">
	/** A work front inside a project, optionally nested under another. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'site_locations'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {ctx} {view} subtitle={['location_code', 'location_type']}>
	<Section icon="lucide:map-pin" first name="location" title={ctx.t('section.location')}>
		<Grid minimum="compact">
			<Field {ctx} name="location_name" />
			<Field {ctx} name="location_code" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.parent_location_id == null}
				<Field {ctx} name="parent_location_id" />
			{/if}
			<Field {ctx} name="location_type" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:book-marked"
		name="reference"
		title={ctx.t('section.model_reference')}
		default_open={false}
		summary={record?.['grid_reference'] || ctx.t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field {ctx} name="grid_reference" />
			<Field {ctx} name="bim_model_element_id" />
			<Column span="all"><Field {ctx} name="coordinates" /></Column>
		</Grid>
	</Section>
</RecordForm>
