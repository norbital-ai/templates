<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'payment_claims'> } = $props();
</script>

<RecordForm {view} subtitle={['claim_type', 'status']}>
	<Field name="claim_number" />
	<RefField name="project_id" ref="project" />
	<RefField name="job_id" ref="job" />
	<Field name="claim_type" />
	<Field name="status" />
	<Field name="currency" />
	<Field name="claimed_amount" />
	<Field name="certified_amount" />
	<Field name="claim_period" />
	<Field name="submitted_date" />
	<Field name="paid_date" />
	<Column span="all"><Field name="description" /></Column>
</RecordForm>
