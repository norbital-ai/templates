<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'statutory_finding'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="statutory_finding"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
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
			{ctx}
			of="jurisdiction_change"
			key="finding_changes"
			where={{ finding_id: { eq: record.id } }}
			columns={['effective_from', 'law']}
		/>{/if}
</RecordShell>
