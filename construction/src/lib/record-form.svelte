<script lang="ts">
	/**
	 * A record view that is one form: the record frame, and the collection's form laid out by the page's `Section`s. A
	 * create opens the new record, as the generated view does.
	 */
	import type { Snippet } from 'svelte';
	import type { CollectionName } from '@norbital-ai/bolt';
	import { Form } from '@norbital-ai/ui';
	import { RecordShell, openRecord, type RecordView } from '@norbital-ai/ui';

	let {
		view,
		subtitle,
		children
	}: {
		view: RecordView<CollectionName>;
		/** The fields under the heading, each shown by its kind. */
		subtitle?: readonly string[];
		children: Snippet;
	} = $props();
	const of = $derived(view.collection);
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell
	{of}
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...subtitle === undefined ? {} : { subtitle }}
>
	<Form
		{of}
		mode={view.mode}
		{...record == null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		onOutcome={(outcome) => {
			const created = outcome.kind === 'committed' ? outcome.records[0] : undefined;
			if (view.mode === 'create' && created !== undefined) openRecord(of, created.id);
		}}
	>
		{@render children()}
	</Form>
</RecordShell>
