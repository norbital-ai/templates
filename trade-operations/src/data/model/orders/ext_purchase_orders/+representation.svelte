<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import ExternalOrderGeneral from '../../../../lib/ui/external-order-general.svelte';
	import { RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	let {
		view,
		ctx
	}: {
		view: RecordView<'ext_purchase_orders'>;
		ctx: PageContext;
	} = $props();
</script>

{#snippet general(recordView: RecordView)}<ExternalOrderGeneral
		{ctx}
		of="ext_purchase_orders"
		view={recordView}
	/>{/snippet}
{#snippet transactions()}{#if view.mode !== 'create'}
		<Table
			{ctx}
			of="transactions"
			where={{ ext_purchase_order: { eq: view.record.id } }}
			columns={['reference', 'kind', 'status', 'source_updated_at']}
			toolbar={{ new: false }}
		/>
	{/if}{/snippet}
<RecordShell
	{ctx}
	of="ext_purchase_orders"
	mode={view.mode}
	{...view.mode !== 'create' ? { id: view.record.id } : { values: view.values }}
	children={general}
	tabs={[{ name: 'transactions', title: ctx.t('section.transactions'), body: transactions }]}
/>
