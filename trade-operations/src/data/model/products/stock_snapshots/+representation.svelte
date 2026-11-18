<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	let { view, ctx }: { view: RecordView<'stock_snapshots'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm
	{ctx}
	{view}
	readonly
	readonly_reason={ctx.t('component.kingdee_readonly')}
	sections={[
		{
			name: 'stock_snapshots',
			fields: [
				'product',
				'warehouse',
				'lot_number',
				'unit',
				'on_hand',
				'erp_committed',
				'currency',
				'unit_cost',
				'external_code',
				'as_of',
				'orders_as_of'
			]
		}
	]}
/>
