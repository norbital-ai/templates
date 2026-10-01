<script lang="ts">
	/** A purchase order: its number and total, its terms, its lines (added here while a draft), and the export once confirmed. */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ExportRun from '../../../lib/ui/export-run.svelte';

	let { view }: { view: RecordView<'purchase_orders'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#snippet actions()}
	{#if view.mode === 'update' && view.record.status === 'confirmed'}<ExportRun
			collection="purchase_orders"
			id={view.record.id}
		/>{/if}
{/snippet}
{#snippet lines()}
	{#if view.mode === 'update'}
		<Stack gap="md">
			<Table
				of="purchase_order_lines"
				key="order-lines-of"
				toolbar={{ new: false }}
				where={{ purchase_order_id: { eq: view.record.id } }}
				columns={[
					{ field: 'product_code', label: t('component.code') },
					{ field: 'product_name', label: t('component.product') },
					'quantity',
					'received',
					{ field: 'unit_cost', label: t('component.unit_cost') },
					{ field: 'tax_rate', label: t('component.tax_rate') },
					{ field: 'line_total', label: t('component.total') }
				]}
			/>
			{#if view.record.status === 'draft'}<RecordShell
					of="purchase_order_lines"
					mode="create"
					values={{ purchase_order_id: view.record.id }}
				/>{/if}
		</Stack>
	{/if}
{/snippet}

<RecordForm
	{view}
	{actions}
	subtitle={['supplier_id', 'status']}
	tabs={[{ name: 'lines', title: t('component.lines'), body: lines }]}
	sections={[
		{
			name: 'order',
			title: t('section.order'),
			fields: ['supplier_id', 'status', 'currency', 'tax_inclusive', 'expected_date', 'owner_id']
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
