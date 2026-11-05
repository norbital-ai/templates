<script lang="ts">
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'statutory_change'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="statutory_change"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="statutory_change"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={record === null
			? [
					'finding_id',
					'jurisdiction_code',
					'family',
					'row_code',
					'field_path',
					'old_value',
					'new_value',
					'effective_from',
					'baseline_version_id',
					'notes'
				]
			: [
					'old_value',
					'new_value',
					'effective_from',
					'baseline_version_id',
					'applied_version_id',
					'notes'
				]}
	/>
</RecordShell>
