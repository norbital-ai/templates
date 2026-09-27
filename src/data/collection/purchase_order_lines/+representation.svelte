<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';
	import { num } from '../../../lib/pricing.js';

	let { view }: { view: RecordView<'purchase_order_lines'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `Unit cost ${num(r.unit_cost)} · Total ${num(r.line_total)}`}
	fields={[
		['purchase_order_id', 'component.purchase_order'],
		['product_id', 'component.product'],
		'quantity',
		['unit_cost', 'component.unit_cost'],
		['tax_rate', 'component.tax_rate']
	]}
/>
