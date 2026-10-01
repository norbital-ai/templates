<script lang="ts">
	/** A supplier invoice: its number and total, the order it bills, and its lines (added here while a draft). */
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ConfirmedPick from '../../../lib/ui/confirmed-pick.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: RecordView<'purchase_invoices'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#snippet lines()}
	{#if view.mode === 'update'}
		<Stack gap="md">
			<Table
				of="purchase_invoice_lines"
				key="purchase-invoice-lines-of"
				toolbar={{ new: false }}
				where={{ purchase_invoice_id: { eq: view.record.id } }}
				columns={[
					{ field: 'product_code', label: t('component.code') },
					{ field: 'product_name', label: t('component.product') },
					'quantity',
					{ field: 'unit_cost', label: t('component.unit_cost') },
					{ field: 'tax_rate', label: t('component.tax_rate') },
					{ field: 'line_total', label: t('component.total') }
				]}
			/>
			{#if view.record.status === 'draft'}<RecordShell
					of="purchase_invoice_lines"
					mode="create"
					values={{ purchase_invoice_id: view.record.id }}
				/>{/if}
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
	subtitle={['purchase_order_id', 'supplier_name', 'status']}
	tabs={[{ name: 'lines', title: t('component.lines'), body: lines }]}
	sections={[
		{
			name: 'invoice',
			title: t('section.invoice'),
			fields: ['purchase_order_id', 'invoice_reference', 'invoice_date', 'status', 'owner_id']
		},
		...(record
			? [
					{
						name: 'cancellation',
						title: t('section.cancellation'),
						fields: ['cancel_reason'],
						closed: record?.['cancel_reason'] || t('section.not_cancelled')
					}
				]
			: [])
	]}
/>
