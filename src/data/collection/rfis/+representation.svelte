<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'rfis'> } = $props();
</script>

<RecordForm {view} subtitle={['rfi_number', 'status']}>
	<Field name="rfi_number" />
	<Field name="title" />
	<RefField name="project_id" ref="project" />
	<Field name="status" />
	<Field name="priority" />
	<Field name="asked_by" />
	<Field name="assigned_to" />
	<Field name="due_date" />
	<Column span="all"><Field name="question" /></Column>
	<Column span="all"><Field name="answer" /></Column>
</RecordForm>
