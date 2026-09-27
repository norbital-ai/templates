<script lang="ts">
	/** A work front inside a project, optionally nested under another. */
	import { Column } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'site_locations'> } = $props();
</script>

<RecordForm {view} subtitle={['location_code', 'location_type']}>
	<Field name="location_name" label={bolt.t('component.location_name')} />
	<Field name="location_code" label={bolt.t('component.location_code')} />
	<RefField name="project_id" ref="project" />
	<RefField name="parent_location_id" ref="site" label={bolt.t('component.parent_location')} />
	<Field name="location_type" label={bolt.t('component.location_type')} />
	<Field name="grid_reference" label={bolt.t('component.grid_reference')} />
	<Field name="bim_model_element_id" label={bolt.t('component.bim_element')} />
	<Column span="all"><Field name="description" label={bolt.t('component.description')} /></Column>
	<Column span="all"><Field name="coordinates" label={bolt.t('component.coordinates')} /></Column>
</RecordForm>
