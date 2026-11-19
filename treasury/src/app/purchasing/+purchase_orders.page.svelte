<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

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
			'currency',
			'amount',
			'quantity',
			'invoiced_amount',
			'payment_date',
			'lc_requested',
			'is_cancelled'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
