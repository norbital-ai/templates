<script lang="ts">
	import { bolt } from '$bolt';
	import ExternalOrderGeneral from '../../../lib/ui/external-order-general.svelte';
	import { RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	let {
		view
	}: {
		view: RecordView<'ext_purchase_orders'>;
	} = $props();
</script>

{#snippet general(recordView: RecordView)}<ExternalOrderGeneral
		of="ext_purchase_orders"
		view={recordView}
	/>{/snippet}
{#snippet transactions()}{#if view.mode !== 'create'}
		<Table
			of="transactions"
			where={{ ext_purchase_order: { eq: view.record.id } }}
			columns={['reference', 'kind', 'status', 'source_updated_at']}
			toolbar={{ new: false }}
		/>
	{/if}{/snippet}
<RecordShell
	of="ext_purchase_orders"
	mode={view.mode}
	{...view.mode !== 'create' ? { id: view.record.id } : { values: view.values }}
	children={general}
	tabs={[{ name: 'transactions', title: bolt.t('section.transactions'), body: transactions }]}
/>
