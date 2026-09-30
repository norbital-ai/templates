<script lang="ts">
	/** A goods receipt: its number, the order it receives against, and what arrived (recorded here). */
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ConfirmedPick from '../../../lib/ui/confirmed-pick.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: RecordView<'goods_receipts'> } = $props();
	const t = bolt.t;
</script>

{#snippet lines()}
	{#if view.mode === 'update'}
		<Stack gap="md">
			<Table
				of="goods_receipt_lines"
				key="receipt-lines-of"
				toolbar={{ new: false }}
				where={{ goods_receipt_id: { eq: view.record.id } }}
				columns={[
					{ field: 'purchase_order_line_id', label: t('component.order_line') },
					{ field: 'quantity_received', label: t('component.received_quantity') }
				]}
			/>
			<RecordShell
				of="goods_receipt_lines"
				mode="create"
				values={{ goods_receipt_id: view.record.id }}
			/>
		</Stack>
	{/if}
{/snippet}

{#snippet parent(form: FormState)}<ConfirmedPick
		{form}
		field="purchase_order_id"
		of="purchase_orders"
	/>{/snippet}

<RecordForm
	{view}
	editors={{ purchase_order_id: parent }}
	subtitle={['purchase_order_id', 'received_date']}
	tabs={[{ name: 'lines', title: t('component.lines'), body: lines }]}
	fields={['purchase_order_id', 'received_date', 'owner_id', 'note']}
/>
