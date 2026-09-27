<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import type { CollectionName, MessageKey } from '@norbital-ai/bolt';

	/** A field of the form: its name, and the message key of its label (the field's name when absent). */
	export type FormField = string | readonly [name: string, label: MessageKey];
	export type RecordFormProps = {
		view: RecordView<CollectionName>;
		subtitle?: (record: { readonly [field: string]: unknown }) => string;
		/** In form order; a field the caller may not write in this mode renders nothing. */
		fields: readonly FormField[];
		/** A field's own editor (a picker filtered by another field, say). */
		editors?: { readonly [field: string]: Snippet<[FormState]> };
		actions?: Snippet;
	};
</script>

<script lang="ts">
	/**
	 * A collection's record view: the record frame with its subtitle, and the form over the fields in order, each
	 * labelled from the workspace messages (the kit's form takes a field label as given); `status` offers the moves out of the stored state (the kit's
	 * form never edits a state).
	 */
	import { bolt } from '$bolt';
	import { Combobox, Field, Form } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { openRecord, RecordShell } from '@norbital-ai/ui';

	let { view, subtitle, fields, editors = {}, actions }: RecordFormProps = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const cells: { readonly [field: string]: unknown } | null = $derived(
		view.mode === 'update' ? view.record : null
	);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const labelOf = (name: string, key: MessageKey | undefined) => (key ? bolt.t(key) : undefined); // the field humanizes its name
</script>

<RecordShell
	of={view.collection}
	mode={view.mode}
	{...record ? { id: record.id, subtitle: subtitle?.(record) ?? '' } : { values }}
	{...actions ? { actions } : {}}
>
	<Form
		of={view.collection}
		mode={view.mode}
		{...record ? { id: record.id, record } : { values }}
		onOutcome={(o) => {
			// a new record opens once it exists
			if (!record && o.kind === 'committed' && o.records[0])
				openRecord(view.collection, o.records[0].id);
		}}
	>
		{#snippet children(form)}
			<Grid gap="md" minimum="compact">
				{#each fields as f (typeof f === 'string' ? f : f[0])}
					{@const [name, key] = typeof f === 'string' ? [f, undefined] : f}
					{#if editors[name]}
						<Field {name} label={labelOf(name, key)}>
							{#snippet editor()}{@render editors[name]!(form)}{/snippet}
						</Field>
					{:else if name === 'status' && cells}
						<!-- a state moves along its edges: the stored state and the moves out of it -->
						<Field {name} label={labelOf(name, key)}>
							{#snippet editor(field)}
								{@const from = String(cells.status)}
								<Combobox
									size="sm"
									options={[
										from,
										...(field.kind.kind === 'state' ? (field.kind.states[from]?.to ?? []) : [])
									].map((s) => ({ value: s, label: s.replaceAll('_', ' ') }))}
									value={String(field.value)}
									disabled={field.disabled}
									onChange={(s) => s !== null && field.onChange(s)}
								/>
							{/snippet}
						</Field>
					{:else}
						<Field {name} label={labelOf(name, key)} />
					{/if}
				{/each}
			</Grid>
		{/snippet}
	</Form>
</RecordShell>
