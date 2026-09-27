<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'goods_receipt_lines'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) =>
		`Receipt ${String(r.goods_receipt_id).slice(0, 8)} · Order line ${String(r.purchase_order_line_id).slice(0, 8)}`}
	fields={[
		['goods_receipt_id', 'component.goods_receipt'],
		['purchase_order_line_id', 'component.order_line'],
		['quantity_received', 'component.received_quantity']
	]}
/>
