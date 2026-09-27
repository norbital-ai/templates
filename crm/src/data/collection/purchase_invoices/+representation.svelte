<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'purchase_invoices'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `${r.status}${r.supplier_name ? ` · ${r.supplier_name}` : ''}`}
	fields={[
		['purchase_order_id', 'component.purchase_order'],
		['invoice_reference', 'component.supplier_invoice_no'],
		['invoice_date', 'component.invoice_date'],
		'status',
		['owner_id', 'component.owner'],
		'cancel_reason'
	]}
/>
