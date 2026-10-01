<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import type { CollectionName } from '@norbital-ai/bolt';
	import type { RecordTab } from '@norbital-ai/ui';

	/** One titled group of fields. */
	export type FormSection = {
		/** The stable key the viewer's open state is remembered under. */
		name: string;
		title: string;
		/** In form order, each labelled from the catalog. */
		fields: readonly string[];
		/** A secondary section: closed until opened, showing this line ("No notes", "Not set"). */
		closed?: string;
	};

	export type RecordFormProps = {
		view: RecordView<CollectionName>;
		/** The fields under the record's label, each shown by its kind. */
		subtitle?: readonly string[];
		/** The form's sections in order; a field the caller may not write in this mode renders nothing. */
		sections: readonly FormSection[];
		/** A field's own editor (a picker filtered by another field, say). */
		editors?: { readonly [field: string]: Snippet<[FormState]> };
		actions?: Snippet;
		/** Tabs beside the form, on a stored record (a document's lines). */
		tabs?: readonly RecordTab[];
	};
</script>

<script lang="ts">
	/**
	 * A collection's record view: the record frame with its subtitle, and the form in its sections; `status`
	 * offers the moves out of the stored state (the kit's form never edits a state). A record in a final state (no moves
	 * out, nothing editable) is shown readonly.
	 */
	import { Combobox, Field, Form, Section } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { openRecord, RecordShell, useEnumText, useKinds } from '@norbital-ai/ui';

	let { view, subtitle, sections, editors = {}, actions, tabs }: RecordFormProps = $props();
	const kinds = useKinds();
	const words = useEnumText();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const cells: { readonly [field: string]: unknown } | null = $derived(
		view.mode === 'update' ? view.record : null
	);
	const values = $derived(view.mode === 'create' ? view.values : {});
	// a create its parent scopes (a document's add-line form, `values` given) stays open for the next one
	const scoped = $derived(Object.keys(values).length > 0);
	let added = $state(0);
	const final = $derived.by(() => {
		if (cells === null) return false;
		const fields = kinds.catalog?.[view.collection]?.fields ?? {};
		const state = Object.entries(fields).find(([, k]) => k.kind === 'state');
		if (state?.[1].kind !== 'state') return false;
		const at = state[1].states[String(cells[state[0]])];
		return at !== undefined && (at.to ?? []).length === 0 && at.edit === 'none';
	});
</script>

{#snippet field(name: string, form: FormState)}
	{#if Object.entries(values).some(([field, value]) => field === name && value != null)}
		<!-- the parent scoping this create: fixed, not asked -->
	{:else if editors[name]}
		<Field {name}>
			{#snippet editor()}{@render editors[name]!(form)}{/snippet}
		</Field>
	{:else if name === 'status' && cells}
		<!-- a state moves along its edges: the stored state and the moves out of it -->
		<Field {name}>
			{#snippet editor(field)}
				{@const from = String(cells.status)}
				<Combobox
					size="sm"
					options={[
						from,
						...(field.kind.kind === 'state' ? (field.kind.states[from]?.to ?? []) : [])
					].map((s) => ({ value: s, label: words(s, name) }))}
					value={String(field.value)}
					disabled={field.disabled}
					onChange={(s) => s !== null && field.onChange(s)}
				/>
			{/snippet}
		</Field>
	{:else}
		<Field {name} />
	{/if}
{/snippet}

<RecordShell
	of={view.collection}
	mode={view.mode}
	{...record
		? {
				id: record.id,
				...(subtitle ? { subtitle } : {}),
				...(tabs ? { tabs } : {})
			}
		: { values }}
	{...actions ? { actions } : {}}
>
	{#key added}<Form
			of={view.collection}
			mode={view.mode}
			readonly={final}
			{...record ? { id: record.id, record } : { values }}
			onOutcome={(o) => {
				// a new record opens once it exists
				if (record || o.kind !== 'committed' || !o.records[0]) return;
				if (scoped) added++;
				else openRecord(view.collection, o.records[0].id);
			}}
		>
			{#snippet children(form)}
				{#each sections as section, i (section.name)}
					<Section
						first={i === 0}
						name={section.name}
						title={section.title}
						{...section.closed === undefined
							? {}
							: {
									defaultOpen: false,
									...(typeof section.closed === 'string' ? { summary: section.closed } : {})
								}}
					>
						<Grid gap="md" minimum="compact">
							{#each section.fields as name (name)}{@render field(name, form)}{/each}
						</Grid>
					</Section>
				{/each}
			{/snippet}
		</Form>{/key}
</RecordShell>
