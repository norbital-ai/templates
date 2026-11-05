<script lang="ts">
	import { Form, RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'statutory_finding'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="statutory_finding"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="statutory_finding"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={record === null
			? [
					'jurisdiction_code',
					'instrument_key',
					'title',
					'fit',
					'families',
					'summary',
					'announced_on',
					'source_urls',
					'source_quote',
					'notes'
				]
			: [
					'status',
					'title',
					'fit',
					'families',
					'summary',
					'announced_on',
					'source_urls',
					'source_quote',
					'verified_on',
					'verified_by',
					'research_run_id',
					'notes'
				]}
	/>
	{#if record !== null}<Table
			of="statutory_change"
			key="finding_changes"
			where={{ finding_id: { eq: record.id } }}
			toolbar={{ new: record.status === 'PROPOSED' }}
			columns={[
				'family',
				'row_code',
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'applied_version_id'
			]}
		/>{/if}
</RecordShell>
