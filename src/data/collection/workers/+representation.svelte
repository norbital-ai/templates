<script lang="ts">
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view }: { view: RecordView<'workers'> } = $props();
</script>

<RecordForm {view} subtitle={['worker_number', 'trade', 'status']}>
	<Field name="worker_name" />
	<Field name="worker_number" />
	<Field name="trade" />
	<Field name="status" />
	<Field name="phone" />
	<Field name="email" />
	<Field name="date_of_birth" />
	<Field name="nationality" />
	<Field name="work_permit_expiry" />
	<Field name="medical_check_date" />
	<Field name="safety_induction_date" />
</RecordForm>
