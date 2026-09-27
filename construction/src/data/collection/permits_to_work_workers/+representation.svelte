<script lang="ts">
	/** A permit and a worker named on it. */
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'permits_to_work_workers'> } = $props();
</script>

<RecordForm {view} kind="Permit worker">
	<RefField name="permits_to_work_id" ref="permit" />
	<RefField name="worker_id" ref="worker" />
</RecordForm>
