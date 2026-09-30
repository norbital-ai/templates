<script lang="ts">
	/**
	 * A claim's or ad hoc request's `facts`, edited against the `request_facts` its catalogue row
	 * declares. Only that row's declarations are read; a type that declares none shows nothing.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import EntityFactsRenderer from '../../data/custom_field/entity_facts/+renderer.svelte';
	import type { FactKey } from '../datatypes/fact_keys.js';
	import { liveRows } from './live.svelte.js';

	let {
		view,
		catalogue,
		catalogueId
	}: {
		view: CustomFieldView<{ readonly [key: string]: string | number | boolean }>;
		catalogue: 'claim_catalogue' | 'adhoc_catalogue';
		catalogueId: string | null;
	} = $props();
	const rows = liveRows<{ readonly request_facts?: readonly FactKey[] | null }>(() => {
		if (!catalogueId) return null;
		const select = { request_facts: true } as const;
		return catalogue === 'claim_catalogue'
			? bolt.read('claim_catalogue', {
					where: { id: { eq: catalogueId as Id<'claim_catalogue'> } },
					select,
					all: true
				})
			: bolt.read('adhoc_catalogue', {
					where: { id: { eq: catalogueId as Id<'adhoc_catalogue'> } },
					select,
					all: true
				});
	});
	const declarations = $derived(rows.current?.[0]?.request_facts ?? []);
</script>

{#if declarations.length > 0}
	<EntityFactsRenderer {view} {declarations} />
{/if}
