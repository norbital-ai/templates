<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ProductPick from '../../../lib/ui/product-pick.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'quote_lines'> } = $props();
</script>

{#snippet product(form: FormState)}<ProductPick {form} price="unit_price" />{/snippet}

<RecordForm
	{view}
	subtitle={['quote_id']}
	editors={{ product_id: product }}
	fields={['quote_id', 'product_id', 'quantity', 'unit_price', 'discount_pct', 'tax_rate']}
/>
