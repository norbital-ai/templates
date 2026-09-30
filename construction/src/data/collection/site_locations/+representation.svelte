<script lang="ts">
	/** A work front inside a project, optionally nested under another. */
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'site_locations'> } = $props();
</script>

<RecordForm {view} subtitle={['location_code', 'location_type']}>
	<Field name="location_name" />
	<Field name="location_code" />
	<RefField name="project_id" ref="project" />
	<RefField name="parent_location_id" ref="site" />
	<Field name="location_type" />
	<Field name="grid_reference" />
	<Field name="bim_model_element_id" />
	<Column span="all"><Field name="description" /></Column>
	<Column span="all"><Field name="coordinates" /></Column>
</RecordForm>
