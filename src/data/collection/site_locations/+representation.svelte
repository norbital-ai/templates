<script lang="ts">
	/** A work front inside a project, optionally nested under another. */
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'site_locations'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['location_code', 'location_type']}>
	<Section first name="location" title={t('section.location')}>
		<Grid minimum="compact">
			<Field name="location_name" />
			<Field name="location_code" />
			<RefField name="project_id" ref="project" />
			<RefField name="parent_location_id" ref="site" />
			<Field name="location_type" />
		</Grid>
	</Section>
	<Section
		name="reference"
		title={t('section.model_reference')}
		defaultOpen={false}
		summary={record?.['grid_reference'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="grid_reference" />
			<Field name="bim_model_element_id" />
			<Column span="all"><Field name="coordinates" /></Column>
		</Grid>
	</Section>
	<Section
		name="description"
		title={t('section.description')}
		defaultOpen={false}
		summary={record?.['description'] || t('section.no_description')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
</RecordForm>
