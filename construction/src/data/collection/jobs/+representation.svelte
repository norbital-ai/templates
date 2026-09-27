<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'jobs'> } = $props();
</script>

<RecordForm {view} subtitle={['job_number', 'status']}>
	<Field name="job_title" />
	<Field name="job_number" />
	<RefField name="project_id" ref="project" />
	<RefField name="site_location_id" ref="site" />
	<RefField name="bim_reference_id" ref="bim" />
	<Field name="job_type" />
	<Field name="status" />
	<Field name="priority" />
	<Field name="schedule_range" />
	<Field name="currency" />
	<Field name="budget" />
	<Column span="all"><Field name="description" /></Column>
</RecordForm>
