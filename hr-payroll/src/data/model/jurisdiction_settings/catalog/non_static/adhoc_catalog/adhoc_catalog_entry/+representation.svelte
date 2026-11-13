<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { paidPeriods } from '../../../../../../../lib/ui/payroll/paid_period.svelte.js';
	let { view, ctx }: { view: RecordView<'adhoc_catalog_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
</script>

<RecordShell
	{ctx}
	of="adhoc_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="adhoc_catalog_entry"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		confirm={paid.confirm(() => record?.payroll_run_id != null, ['incurred_on'])}
	>
		{#snippet children()}<Stack gap="md">
				{#each record === null ? ['employment_id', 'catalog_id', 'description', 'quantity', 'unit', 'incurred_on', 'evidence_file'] : ['description', 'quantity', 'unit', 'incurred_on', 'evidence_file'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}
			</Stack>{/snippet}
	</Form>
</RecordShell>
