<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';
	import { num } from '../../../lib/pricing.js';

	let { view }: { view: RecordView<'purchase_invoice_lines'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `Unit cost ${num(r.unit_cost)} · Total ${num(r.line_total)}`}
	fields={[
		['purchase_invoice_id', 'component.purchase_invoice'],
		['purchase_order_line_id', 'component.order_line'],
		'quantity',
		['unit_cost', 'component.unit_cost'],
		['tax_rate', 'component.tax_rate']
	]}
/>
