<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'defects'> } = $props();
</script>

<RecordForm {view} subtitle={['defect_number', 'status']}>
	<Field name="defect_number" />
	<Field name="title" />
	<RefField name="project_id" ref="project" />
	<RefField name="site_location_id" ref="site" />
	<Field name="category" />
	<Field name="severity" />
	<Field name="status" />
	<Field name="assigned_to" />
	<Field name="due_date" />
	<Field name="closed_date" />
	<Column span="all"><Field name="description" /></Column>
	<Column span="all"><Field name="resolution_notes" /></Column>
</RecordForm>
