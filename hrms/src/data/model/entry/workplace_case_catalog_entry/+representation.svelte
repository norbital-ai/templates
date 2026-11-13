<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	let { view, ctx }: { view: RecordView<'workplace_case_catalog_entry'>; ctx: PageContext } =
		$props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sealed = $derived(record?.payroll_run_id != null);
</script>

<RecordShell
	{ctx}
	of="workplace_case_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	{...sealed ? { badge: ctx.t('entry.included_in_payroll') } : {}}
>
	<Form
		{ctx}
		of="workplace_case_catalog_entry"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md">
				<CatalogField {ctx} of="workplace_case_catalog" dated="occurred_on" />
				{#each ['entity_id', 'employment_id', 'severity', 'occurred_on', 'location', 'reference', 'description', 'kind', 'opened_on', 'scheduled_on', 'closed_on', 'inputs', 'evidence_file'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}
			</Stack>{/snippet}
	</Form>
</RecordShell>
