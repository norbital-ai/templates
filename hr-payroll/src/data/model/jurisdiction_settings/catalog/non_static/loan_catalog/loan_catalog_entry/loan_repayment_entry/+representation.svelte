<script lang="ts">
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'loan_repayment_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="loan_repayment_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="loan_repayment_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={['amount', 'paid_on', 'payment_reference', 'reverses']}
	/>
</RecordShell>
