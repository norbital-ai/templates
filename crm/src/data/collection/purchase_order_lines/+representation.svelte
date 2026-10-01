<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ProductPick from '../../../lib/ui/product-pick.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'purchase_order_lines'> } = $props();
	const t = bolt.t;
</script>

{#snippet product(form: FormState)}<ProductPick {form} />{/snippet}

<RecordForm
	{view}
	subtitle={['purchase_order_id']}
	editors={{ product_id: product }}
	sections={[
		{
			name: 'line',
			title: t('section.line'),
			fields: ['purchase_order_id', 'product_id', 'quantity', 'unit_cost', 'tax_rate']
		}
	]}
/>
