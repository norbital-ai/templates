<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';
	import { num } from '../../../lib/pricing.js';

	let { view }: { view: RecordView<'quote_lines'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `Unit price ${num(r.unit_price)} · Total ${num(r.line_total)}`}
	fields={[
		['quote_id', 'component.quote'],
		['product_id', 'component.product'],
		'quantity',
		['unit_price', 'component.unit_price'],
		['discount_pct', 'component.discount_pct'],
		['tax_rate', 'component.tax_rate']
	]}
/>
