<script lang="ts">
	/** An invoice: its number and total, the quote it bills, and its lines (added here while it is a draft). */
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ConfirmedPick from '../../../lib/ui/confirmed-pick.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: RecordView<'sales_invoices'> } = $props();
	const t = bolt.t;
</script>

{#snippet lines()}
	{#if view.mode === 'update'}
		<Stack gap="md">
			<Table
				of="sales_invoice_lines"
				key="invoice-lines-of"
				toolbar={{ new: false }}
				where={{ sales_invoice_id: { eq: view.record.id } }}
				columns={[
					{ field: 'product_code', label: t('component.code') },
					{ field: 'product_name', label: t('component.product') },
					'quantity',
					{ field: 'unit_price', label: t('component.unit_price') },
					{ field: 'discount_pct', label: t('component.discount_pct') },
					{ field: 'tax_rate', label: t('component.tax_rate') },
					{ field: 'line_total', label: t('component.total') }
				]}
			/>
			{#if view.record.status === 'draft'}<RecordShell
					of="sales_invoice_lines"
					mode="create"
					values={{ sales_invoice_id: view.record.id }}
				/>{/if}
		</Stack>
	{/if}
{/snippet}

{#snippet parent(form: FormState)}<ConfirmedPick {form} field="quote_id" of="quotes" />{/snippet}

<RecordForm
	{view}
	editors={{ quote_id: parent }}
	subtitle={['quote_id', 'status']}
	tabs={[{ name: 'lines', title: t('component.lines'), body: lines }]}
	fields={['quote_id', 'status', 'owner_id', 'cancel_reason']}
/>
