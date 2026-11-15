<script lang="ts">
	/** One keyed block of a law (its lookup, conversions, ledger, work regions or a statutory parameter declaration), edited as folded. Its view's one Save commits the draft. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { StructuredData, use_form } from '@norbital-ai/ui';
	import type { Law } from '../../law.js';
	import { isJsonObject, type Json, type JsonObject } from '../../payroll_engine/foundation.js';
	import LookupSections from './lookup_sections.svelte';

	let {
		ctx,
		law,
		family,
		draft = $bindable()
	}: {
		ctx: PageContext;
		law: Law;
		family:
			| 'lookup'
			| 'conversions'
			| 'ledger'
			| 'work_regions'
			| 'employee_statutory_parameters'
			| 'entity_statutory_parameters';
		/** The edited block; undefined while it is the law's own. */
		draft?: Json | undefined;
	} = $props();

	const form = use_form();
	const editing = $derived(form?.mode !== 'view');
	const block = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : {});
	const value = $derived(block(draft === undefined ? law.settings[family] : draft));
</script>

{#if family === 'lookup'}
	<LookupSections
		{ctx}
		{value}
		name={family}
		disabled={!editing}
		on_change={(next) => (draft = next)}
	/>
{:else}
	<StructuredData
		{ctx}
		name={family}
		mode={editing ? 'edit' : 'view'}
		kind={{ kind: 'json' }}
		{value}
		on_change={(next) => (draft = next)}
	/>
{/if}
