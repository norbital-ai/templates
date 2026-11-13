<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	let { view, ctx }: { view: RecordView<'work_event'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="work_event"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="work_event"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md">
				<Field {ctx} name="entity_id" />
				<Field {ctx} name="employment_id" />
				<CatalogField {ctx} of="work_event_catalog" />
				{#each ['from', 'to', 'location', 'description', 'evidence_file'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}
			</Stack>{/snippet}
	</Form>
</RecordShell>
