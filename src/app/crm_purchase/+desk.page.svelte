<script lang="ts">
	/**
	 * The purchasing desk: a dashboard of orders per status, committed spend (submitted and confirmed orders) per
	 * currency and the top five suppliers by it, then orders, suppliers, receipts, purchase invoices and payments (a
	 * document's lines are a tab of its record). The dashboard is one live read of the orders, derived here.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Show, Tabs } from '@norbital-ai/ui';
	import { Table } from '@norbital-ai/ui';
	import { num } from '../../lib/pricing.js';
	import Ref from '../../lib/ui/ref.svelte';
	import DocLink from '../../lib/ui/doc-link.svelte';

	const t = bolt.t;
	const orders = bolt.live(
		bolt.read('purchase_orders', {
			select: { status: true, currency: true, supplier_id: true, supplier_name: true, gross: true },
			all: true
		})
	);
	const STATUSES = ['draft', 'submitted', 'confirmed', 'cancelled'] as const;
	const dashboard = $derived.by(() => {
		const rows = $orders?.rows ?? [];
		const committed = rows.filter((o) => o.status === 'submitted' || o.status === 'confirmed');
		const by = (key: (o: (typeof rows)[number]) => string) => {
			const out = new Map<string, number>();
			for (const o of committed) out.set(key(o), (out.get(key(o)) ?? 0) + num(o.gross));
			return [...out];
		};
		const names = new Map<string, string>(rows.map((o) => [o.supplier_id, o.supplier_name]));
		const currencies = new Map<string, string | null>(rows.map((o) => [o.supplier_id, o.currency]));
		return {
			counts: STATUSES.map((s) => [s, rows.filter((o) => o.status === s).length] as const),
			spend: by((o) => o.currency ?? '')
				.filter(([c]) => c !== '')
				.sort(([a], [b]) => a.localeCompare(b)),
			suppliers: by((o) => o.supplier_id)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5)
				.map(([id, gross]) => [names.get(id) ?? '—', gross, currencies.get(id)] as const)
		};
	});
</script>

<!-- an arc column shows its row's label (`lib/ui/ref.svelte`); a one-relation column does by default -->
{#snippet regarding({ value }: { value: unknown })}<Ref id={value} />{/snippet}
<!-- a document's number opens it -->
{#snippet orderNo({ row, value }: { row: { id: unknown }; value: unknown })}<DocLink
		of="purchase_orders"
		{row}
		{value}
	/>{/snippet}
{#snippet receiptNo({ row, value }: { row: { id: unknown }; value: unknown })}<DocLink
		of="goods_receipts"
		{row}
		{value}
	/>{/snippet}
{#snippet invoiceNo({ row, value }: { row: { id: unknown }; value: unknown })}<DocLink
		of="purchase_invoices"
		{row}
		{value}
	/>{/snippet}

{#snippet dashboardTab()}
	<Stack gap="lg">
		<Grid minimum="card">
			{#each dashboard.counts as [status, count] (status)}
				<div class="rounded-lg border bg-card p-4">
					<p class="text-sm text-muted-foreground">{t(`component.status_${status}`)}</p>
					<p class="text-2xl font-semibold tabular-nums">{count}</p>
				</div>
			{/each}
		</Grid>
		<Grid minimum="card">
			{#each dashboard.spend as [currency, total] (currency)}
				<div class="rounded-lg border bg-card p-4">
					<p class="text-sm text-muted-foreground">
						{t('app.crm_purchase.committed_spend', { currency })}
					</p>
					<p class="text-2xl font-semibold tabular-nums">
						<Show kind={{ kind: 'money', currency }} value={total} />
					</p>
				</div>
			{/each}
		</Grid>
		{#if dashboard.suppliers.length > 0}
			<Stack gap="none" divided class="rounded-lg border bg-card text-sm">
				<h3 class="px-4 py-3 font-semibold">{t('app.crm_purchase.top_suppliers')}</h3>
				{#each dashboard.suppliers as [name, gross, currency] (name)}
					<Inline justify="between" gap="sm" class="px-4 py-2.5"
						><p class="min-w-0 truncate font-medium">{name}</p>
						<p class="tabular-nums text-muted-foreground">
							<Show
								kind={currency ? { kind: 'money', currency } : { kind: 'decimal', scale: 2 }}
								value={gross}
							/>
						</p></Inline
					>
				{/each}
			</Stack>
		{/if}
	</Stack>
{/snippet}
{#snippet purchaseOrders()}
	<Table
		of="purchase_orders"
		key="purchase_orders"
		toolbar={{ title: t('app.crm_purchase.tab_purchase_orders') }}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			{ field: 'doc_no', label: t('component.doc_no'), cell: orderNo },
			'status',
			{ field: 'supplier_name', label: t('component.supplier') },
			{ field: 'expected_date', label: t('component.expected') },
			{ field: 'gross', label: t('component.gross_amount') },
			{ field: 'confirmed_at', label: t('component.confirmed') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet suppliers()}
	<Table
		of="suppliers"
		key="suppliers"
		toolbar={{ title: t('app.crm_purchase.tab_suppliers') }}
		where={{ active: { eq: true } }}
		orderBy={{ name: 'asc' }}
		columns={[
			'code',
			'name',
			'contact',
			'category',
			'currency',
			{ field: 'payment_terms_days', label: t('component.terms_days') },
			'active'
		]}
	/>
{/snippet}
{#snippet receipts()}
	<Table
		of="goods_receipts"
		key="receipts"
		toolbar={{ title: t('app.crm_purchase.goods_receipts_title') }}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			{ field: 'doc_no', label: t('component.doc_no'), cell: receiptNo },
			{ field: 'purchase_order_id', label: t('component.purchase_order') },
			{ field: 'received_date', label: t('component.received') },
			{ field: 'owner_id', label: t('component.receiver') }
		]}
	/>
{/snippet}
{#snippet invoices()}
	<Table
		of="purchase_invoices"
		key="purchase_invoices"
		toolbar={{ title: t('app.crm_purchase.purchase_invoices_title') }}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			{ field: 'doc_no', label: t('component.doc_no'), cell: invoiceNo },
			{ field: 'purchase_order_id', label: t('component.purchase_order') },
			{ field: 'supplier_name', label: t('component.supplier') },
			{ field: 'invoice_reference', label: t('component.supplier_no') },
			'status',
			{ field: 'gross', label: t('component.gross_amount') }
		]}
	/>
{/snippet}
{#snippet payments()}
	<Table
		of="settlements"
		key="payments"
		toolbar={{ title: t('app.crm_purchase.payments_title') }}
		where={{
			or: [
				{ regarding: { purchase_orders: { isNull: false } } },
				{ regarding: { purchase_invoices: { isNull: false } } }
			]
		}}
		columns={[
			{ field: 'regarding', label: t('component.regarding'), cell: regarding },
			'amount',
			{ field: 'settled_on', label: t('component.settled_on') },
			'reference'
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:shopping-cart"
	title={t('app.crm_purchase.title')}
	description={t('app.crm_purchase.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'dashboard',
				title: t('app.crm_purchase.tab_dashboard'),
				icon: 'lucide:layout-dashboard',
				body: dashboardTab
			},
			{
				name: 'purchase-orders',
				title: t('app.crm_purchase.tab_purchase_orders'),
				icon: 'lucide:shopping-cart',
				body: purchaseOrders
			},
			{
				name: 'suppliers',
				title: t('app.crm_purchase.tab_suppliers'),
				icon: 'lucide:truck',
				body: suppliers
			},
			{
				name: 'goods-receipts',
				title: t('app.crm_purchase.goods_receipts_title'),
				icon: 'lucide:package-check',
				body: receipts
			},
			{
				name: 'purchase-invoices',
				title: t('app.crm_purchase.purchase_invoices_title'),
				icon: 'lucide:receipt',
				body: invoices
			},
			{
				name: 'payments',
				title: t('app.crm_purchase.payments_title'),
				icon: 'lucide:banknote',
				body: payments
			}
		]}
	/>
</AppShell>
