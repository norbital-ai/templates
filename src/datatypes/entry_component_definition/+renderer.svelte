<script lang="ts">
	/**
	 * How a component a person raises an event against produces its amount.
	 *
	 * There is no source picker, because there is no source to pick: the arm is ENTRY and the
	 * schema has no other. That is the whole difference from `component_definition`'s renderer,
	 * which had to ask first and could therefore be answered `SCHEDULE` on a claim catalogue row.
	 * A choice a form never presents is a refusal nobody has to write.
	 *
	 * `source` is still emitted on every value the editor produces. Every reader in the engine
	 * switches on it, and a row that stops carrying it stops being readable as a component.
	 */
	import { Result, Schema } from 'effect';
	import { Grid } from '@norbital-ai/ui/layout';
	import EntryFields from './entry-fields.svelte';
	import { entryComponentDefinitionSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type EntryComponentDefinitionRendererProps = RendererProps & {
		/** The component being edited, which is what scopes the people a cap layer may name. */
		readonly row?: Record<string, unknown>;
	};

	let props: EntryComponentDefinitionRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const companyId = $derived(
		typeof props.row?.company_id === 'string' ? props.row.company_id : null
	);
	const parsed = $derived(
		Schema.decodeUnknownResult(entryComponentDefinitionSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(
		current === null
			? '—'
			: `${current.unit} · ${current.settlement}${current.cap === null ? '' : ' · capped'}`
	);

	/**
	 * What an unset field starts from, so the editor has something to edit.
	 *
	 * The union renderer could leave `current` null and show a source picker over nothing; here
	 * there is nothing to choose, so a null value is drawn as the default rather than as a blank
	 * the operator has no way to fill.
	 */
	const editing = $derived<Value>(
		current ?? {
			source: 'ENTRY',
			unit: 'MONEY',
			evidence: 'NONE',
			cap: null,
			settlement: 'PAYROLL'
		}
	);
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<EntryFields
			value={editing}
			{disabled}
			{companyId}
			onChange={(next) => {
				if (props.mode === 'edit') props.onValueChange(next);
			}}
		/>
	</Grid>
{/if}
