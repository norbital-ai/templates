<script lang="ts">
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'job_assignments'> } = $props();
</script>

<RecordForm {view} subtitle={['role', 'status']}>
	<Field name="assignment_code" />
	<Field name="status" />
	<RefField name="job_id" ref="job" />
	<RefField name="worker_id" ref="worker" />
	<RefField name="site_location_id" ref="site" />
	<Field name="role" />
	<Field name="assignment_range" />
	<Field name="hours_per_day" />
</RecordForm>
