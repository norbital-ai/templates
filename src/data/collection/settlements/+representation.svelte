<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import Regarding from '../../../lib/ui/regarding.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'settlements'> } = $props();
	const KIND: { readonly [collection: string]: string } = {
		quotes: 'quote',
		purchase_orders: 'purchase order',
		purchase_invoices: 'purchase invoice'
	};
</script>

{#snippet regarding(form: FormState)}
	<Regarding
		{form}
		arms={[
			['quotes', 'component.quote'],
			['purchase_orders', 'component.purchase_order'],
			['purchase_invoices', 'component.purchase_invoice']
		]}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={(r) =>
		`${KIND[(r.regarding as { collection?: string } | null)?.collection ?? ''] ?? 'document'} · ${r.settled_on ?? 'unsettled'}`}
	editors={{ regarding }}
	fields={[
		['regarding', 'component.regarding'],
		'amount',
		'currency',
		['settled_on', 'component.settled_on'],
		'reference',
		['owner_id', 'component.recorded_by']
	]}
/>
