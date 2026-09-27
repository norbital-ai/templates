<script lang="ts">
	/** A permit and a certification it requires. */
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'permits_to_work_certification_types'> } = $props();
</script>

<RecordForm {view} kind="Permit certification">
	<RefField name="permits_to_work_id" ref="permit" />
	<RefField name="certification_type_id" ref="certification" />
</RecordForm>
