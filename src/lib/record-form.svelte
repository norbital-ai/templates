<script lang="ts">
	/**
	 * A record view that is one form: the record frame, and the collection's form laid out by the page's `Field`s. A
	 * create opens the new record, as the generated view does.
	 */
	import type { Snippet } from 'svelte';
	import type { CollectionName } from '@norbital-ai/bolt';
	import { Form } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, openRecord, type RecordView } from '@norbital-ai/ui';

	let {
		view,
		subtitle,
		kind,
		children
	}: {
		view: RecordView<CollectionName>;
		/** The fields the subtitle joins, `—` for an empty one. */
		subtitle?: readonly string[];
		/** The frame's title when the row has no label of its own (join rows). */
		kind?: string;
		children: Snippet;
	} = $props();
	const of = $derived(view.collection);
	const record = $derived(view.mode === 'update' ? view.record : null);
	const cells: { readonly [field: string]: unknown } | null = $derived(
		view.mode === 'update' ? view.record : null
	);
	const line = $derived(
		cells == null || subtitle === undefined
			? undefined
			: subtitle
					.map((f) => (cells[f] == null || cells[f] === '' ? '—' : String(cells[f])))
					.join(' · ')
	);
</script>

<RecordShell
	{of}
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...kind === undefined ? {} : { title: kind }}
	{...line === undefined ? {} : { subtitle: line }}
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
		<Grid minimum="compact">{@render children()}</Grid>
	</Form>
</RecordShell>
