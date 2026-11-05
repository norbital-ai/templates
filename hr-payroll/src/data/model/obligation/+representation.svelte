<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'obligation'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="obligation"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="obligation"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={record === null
			? ['entity_id', 'employee_id', 'employment_id', 'title', 'due_on']
			: ['title', 'due_on', 'fulfilled_on', 'evidence', 'waiver_reason', 'state']}
	/>
</RecordShell>
