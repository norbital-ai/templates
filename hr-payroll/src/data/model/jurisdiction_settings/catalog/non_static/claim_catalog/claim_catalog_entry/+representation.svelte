<script lang="ts">
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'claim_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="claim_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="claim_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={record === null
			? ['employment_id', 'catalog_id', 'quantity', 'incurred_on', 'evidence_file', 'is_reversal']
			: ['quantity', 'incurred_on', 'evidence_file', 'is_reversal']}
	/>
</RecordShell>
