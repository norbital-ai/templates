<script lang="ts">
	/** The document a follow-on is raised against (an invoice, a receipt, a contract): only confirmed ones are offered. */
	import type { FormState } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import * as Predicate from '../guards.js';

	let { form, field, of }: { form: FormState; field: string; of: 'quotes' | 'purchase_orders' } =
		$props();
	const chosen = $derived(form.get(field));
	const value = $derived(Predicate.isString(chosen) ? chosen : null);
</script>

{#if of === 'quotes'}
	<Picker
		of="quotes"
		{value}
		where={{ status: { eq: 'confirmed' } }}
		onChange={(id) => form.set(field, id)}
	/>
{:else}
	<Picker
		of="purchase_orders"
		{value}
		where={{ status: { eq: 'confirmed' } }}
		onChange={(id) => form.set(field, id)}
	/>
{/if}
