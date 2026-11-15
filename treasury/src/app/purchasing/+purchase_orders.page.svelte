<script lang="ts">
	/**
	 * Purchase orders: every order the viewer may see (a purchaser sees their own), and those asking to be paid by LC
	 * that no LC is linked to yet. An order's record holds its items, invoices with their checks, and the lines that
	 * pay it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const COLUMNS = [
		'po_number',
		'po_date',
		'supplier',
		'currency',
		'amount',
		'quantity',
		'invoiced_amount',
		'lc_requested',
		'lc_links',
		'is_cancelled'
	] as const;
</script>

{#snippet all()}
	<Table
		{ctx}
		of="purchase_order"
		key="orders"
		order_by={{ po_date: 'desc' }}
		initial_filter={{ is_cancelled: { eq: false } }}
		columns={COLUMNS}
		toolbar={{ title: t('app.orders.all') }}
	/>
{/snippet}
{#snippet lcs()}
	<Table
		{ctx}
		of="purchase_order"
		key="lcs"
		where={{ lc_requested: { eq: true }, is_cancelled: { eq: false }, lc_links: { eq: 0 } }}
		order_by={{ po_date: 'asc' }}
		columns={COLUMNS}
		toolbar={{ title: t('app.alerts.lcs'), new: false }}
	/>
{/snippet}

<AppShell
	icon="lucide:file-text"
	title={t('app.orders.title')}
	description={t('app.orders.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'all', title: t('app.orders.all'), icon: 'lucide:file-text', body: all },
			{ name: 'lcs', title: t('app.alerts.lcs'), icon: 'lucide:file-plus', body: lcs }
		]}
	/>
</AppShell>
