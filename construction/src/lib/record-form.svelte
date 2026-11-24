<script lang="ts">
	/**
	 * A record view that is one form: the record frame, and the model's form laid out by the page's `Section`s.
	 * Create completion delegates to `RecordShell`'s own `on_done` / default navigation.
	 */
	import type { Snippet } from 'svelte';
	import type { ModelName } from '@norbital-ai/bolt';
	import {
		Form,
		RecordShell,
		type FormState,
		type RecordView,
		type RunsForProps,
		type UiContext
	} from '@norbital-ai/ui';
	let {
		ctx,
		view,
		subtitle,
		actions,
		runs,
		children: body
	}: {
		ctx: UiContext;
		view: RecordView<ModelName>;
		/** The fields under the heading, each shown by its kind. */
		subtitle?: readonly string[];
		/** Optional record header actions (e.g. an automation trigger). */
		actions?: Snippet;
		/** Optional persisted automation run history tabs. */
		runs?: readonly RunsForProps[];
		children: Snippet<[FormState]>;
	} = $props();
	const of = $derived(view.model);
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordShell
	{ctx}
	{of}
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...subtitle === undefined ? {} : { subtitle }}
	{...actions === undefined ? {} : { actions }}
	{...runs === undefined ? {} : { runs }}
>
	<Form
		{ctx}
		{of}
		mode={view.mode}
		size="content"
		{...record == null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children(form)}
			{@render body(form)}
		{/snippet}
	</Form>
</RecordShell>
