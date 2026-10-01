<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ProductPick from '../../../lib/ui/product-pick.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'quote_lines'> } = $props();
	const t = bolt.t;
</script>

{#snippet product(form: FormState)}<ProductPick {form} price="unit_price" />{/snippet}

<RecordForm
	{view}
	subtitle={['quote_id']}
	editors={{ product_id: product }}
	sections={[
		{
			name: 'line',
			title: t('section.line'),
			fields: ['quote_id', 'product_id', 'quantity', 'unit_price', 'discount_pct', 'tax_rate']
		}
	]}
/>
