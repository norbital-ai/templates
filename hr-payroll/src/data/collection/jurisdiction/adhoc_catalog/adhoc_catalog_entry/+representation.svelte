<script lang="ts">
	/** One adhoc catalog entry: the person and class pickers narrowed to the page's entity and its governing version. */
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import EntryFields from '../../../../../lib/ui/payroll/entry_fields.svelte';

	let { view }: { view: RecordView<'adhoc_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
</script>

<RecordShell
	of="adhoc_catalog_entry"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="adhoc_catalog_entry"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'adhoc_catalog_entry');
				if (created) openRecord('adhoc_catalog_entry', created.id);
			}}
		>
			{#snippet children(form)}
				<EntryFields
					catalog="adhoc_catalog"
					{form}
					fields={['occurred_on', 'activity', 'amount', 'quantity', 'label', 'reference', 'facts']}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
