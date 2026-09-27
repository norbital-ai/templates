<script lang="ts">
	/** A job and a certification its workers must hold. */
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'jobs_certification_types'> } = $props();
</script>

<RecordForm {view} kind="Job certification">
	<RefField name="job_id" ref="job_coded" />
	<RefField name="certification_type_id" ref="certification" />
</RecordForm>
