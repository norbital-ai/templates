<script lang="ts">
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	let { view }: { view: RecordView<'workplace_case_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sealed = $derived(record?.payroll_run_id != null);
</script>

<RecordShell
	of="workplace_case_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	badge={sealed ? bolt.t('entry.included_in_payroll') : undefined}
>
	<Form
		of="workplace_case_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={[
			'catalog_id',
			'entity_id',
			'kind',
			'opened_on',
			'scheduled_on',
			'closed_on',
			'inputs',
			'evidence_file'
		]}
	/>
</RecordShell>
