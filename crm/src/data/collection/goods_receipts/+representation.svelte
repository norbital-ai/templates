<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'goods_receipts'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => String(r.received_date ?? '')}
	fields={[
		['purchase_order_id', 'component.purchase_order'],
		['received_date', 'component.received_date'],
		['owner_id', 'component.receiver'],
		'note'
	]}
/>
