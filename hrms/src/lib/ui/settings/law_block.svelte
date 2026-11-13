<script lang="ts">
	/** One keyed block of a law (its lookup, conversions, ledger, work regions or an extension schema), edited as folded. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, StructuredData } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { Law } from '../../law.js';
	import { isJsonObject, type Json, type JsonObject } from '../../payroll_engine/foundation.js';
	import { patchOf } from './law_save.js';
	import LookupSections from './lookup_sections.svelte';

	let {
		ctx,
		law,
		family,
		save
	}: {
		ctx: PageContext;
		law: Law;
		family:
			| 'lookup'
			| 'conversions'
			| 'ledger'
			| 'work_regions'
			| 'employee_extension_schema'
			| 'entity_extension_schema';
		/** Asks the save question for a patch; `done` runs once it is written. */
		save: (patch: JsonObject, done: () => void) => void;
	} = $props();

	let draft = $state<Json | undefined>(undefined);
	const block = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : {});
	const held = $derived(block(law.settings[family]));
	const value = $derived(draft === undefined ? held : block(draft));
	const patch = $derived(patchOf({ [family]: held }, { [family]: value }));
	const dirty = $derived(Object.keys(patch).length > 0);
</script>

<Stack gap="md">
	{#if family === 'lookup'}
		<LookupSections {ctx} {value} name={family} on_change={(next) => (draft = next)} />
	{:else}
		<StructuredData
			{ctx}
			name={family}
			mode="edit"
			kind={{ kind: 'json' }}
			{value}
			on_change={(next) => (draft = next)}
		/>
	{/if}
	{#if dirty}
		<Cluster gap="sm" justify="end">
			<Button variant="outline" onclick={() => (draft = undefined)}
				>{ctx.t('component.cancel')}</Button
			>
			<Button onclick={() => save(patch, () => (draft = undefined))}
				>{ctx.t('law_save.save')}</Button
			>
		</Cluster>
	{/if}
</Stack>
