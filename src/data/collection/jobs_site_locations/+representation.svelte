<script lang="ts">
	/** A job and a work front it takes place on. */
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'jobs_site_locations'> } = $props();
</script>

<RecordForm {view} kind="Job location">
	<RefField name="job_id" ref="job_coded" />
	<RefField name="site_location_id" ref="site" />
</RecordForm>
