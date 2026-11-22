<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, format } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

{#snippet moneyCell({
	row,
	value
}: {
	row: { readonly currency: string | null };
	value: string | null | undefined;
})}
	{value == null
		? '—'
		: format({ kind: 'money' }, value, {
				locale: ctx.locale,
				...(row.currency ? { currency: row.currency } : {})
			})}
{/snippet}

<AppShell
	icon="lucide:file-text"
	title={t('app.orders.title')}
	description={t('app.orders.description')}
>
	<Table
		{ctx}
		of="purchase_order"
		initial_filter={{ is_cancelled: { eq: false } }}
		order_by={{ po_date: 'desc' }}
		columns={[
			'po_number',
			'po_date',
			'supplier',
			{
				field: 'amount',
				kind: { kind: 'money', currency: 'currency' },
				align: 'end',
				cell: moneyCell
			},
			'quantity',
			{
				field: 'invoiced_amount',
				kind: { kind: 'money', currency: 'currency' },
				align: 'end',
				cell: moneyCell
			},
			'payment_date',
			'lc_requested',
			'is_cancelled'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
