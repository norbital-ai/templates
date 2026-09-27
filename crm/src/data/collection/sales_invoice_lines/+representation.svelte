<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';
	import { num } from '../../../lib/pricing.js';

	let { view }: { view: RecordView<'sales_invoice_lines'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `Unit price ${num(r.unit_price)} · Total ${num(r.line_total)}`}
	fields={[
		['sales_invoice_id', 'component.sales_invoice'],
		['quote_line_id', 'component.quote_line'],
		'quantity',
		['unit_price', 'component.unit_price'],
		['tax_rate', 'component.tax_rate']
	]}
/>
