<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let { view, ctx }: { view: RecordView<'source_purchase_lines'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm
	{ctx}
	{view}
	readonly
	readonly_reason={ctx.t('component.kingdee_readonly')}
	sections={[
		{
			name: 'document',
			fields: [
				'kind',
				'reference',
				'business_on',
				'supplier_name',
				'order_reference',
				'upstream',
				'active'
			]
		},
		{
			name: 'line',
			fields: [
				'product_name',
				'lot_number',
				'warehouse_code',
				'quantity',
				'unit',
				'net_amount',
				'tax_amount'
			]
		},
		{
			name: 'payable',
			fields: ['billed_amount', 'open_amount', 'due_on', 'paid_on']
		}
	]}
/>
