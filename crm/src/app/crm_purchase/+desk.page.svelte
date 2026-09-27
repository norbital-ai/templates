<script lang="ts">
	/**
	 * The purchasing desk: a dashboard of orders per status, committed spend (submitted and confirmed orders) per
	 * currency and the top five suppliers by it, then orders, order lines, suppliers, receipts, receipt lines, purchase
	 * invoices, their lines and payments. The dashboard is one live read of the orders, derived here.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { Table } from '@norbital-ai/ui';
	import { num } from '../../lib/pricing.js';
	import Ref from '../../lib/ui/ref.svelte';

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
		return {
			counts: STATUSES.map((s) => [s, rows.filter((o) => o.status === s).length] as const),
			spend: by((o) => o.currency ?? '')
				.filter(([c]) => c !== '')
				.sort(([a], [b]) => a.localeCompare(b)),
			suppliers: by((o) => o.supplier_id)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5)
				.map(([id, gross]) => [names.get(id) ?? id, gross] as const)
		};
	});
</script>

<!-- an arc column shows its row's label (`lib/ui/ref.svelte`); a one-relation column does by default -->
{#snippet regarding({ value }: { value: unknown })}<Ref id={value} />{/snippet}

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
					<p class="text-2xl font-semibold tabular-nums">{total.toLocaleString()}</p>
				</div>
			{/each}
		</Grid>
		{#if dashboard.suppliers.length > 0}
			<Stack gap="none" divided class="rounded-lg border bg-card text-sm">
				<h3 class="px-4 py-3 font-semibold">{t('app.crm_purchase.top_suppliers')}</h3>
				{#each dashboard.suppliers as [name, gross] (name)}
					<Inline justify="between" gap="sm" class="px-4 py-2.5"
						><p class="min-w-0 truncate font-medium">{name}</p>
						<p class="tabular-nums text-muted-foreground">{gross.toLocaleString()}</p></Inline
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
			{ field: 'doc_no', label: t('component.doc_no') },
			'status',
			{ field: 'supplier_name', label: t('component.supplier') },
			'currency',
			{ field: 'expected_date', label: t('component.expected') },
			{ field: 'gross', label: t('component.gross_amount') },
			{ field: 'confirmed_at', label: t('component.confirmed') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet orderLines()}
	<Table
		of="purchase_order_lines"
		key="po_lines"
		toolbar={{ title: t('app.crm_purchase.tab_po_lines') }}
		columns={[
			{ field: 'purchase_order_id', label: t('component.purchase_order') },
			{ field: 'product_code', label: t('component.code') },
			{ field: 'product_name', label: t('component.product') },
			'quantity',
			'received',
			{ field: 'unit_cost', label: t('component.unit_cost') },
			{ field: 'line_total', label: t('component.total') }
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
			{ field: 'doc_no', label: t('component.doc_no') },
			{ field: 'purchase_order_id', label: t('component.purchase_order') },
			{ field: 'received_date', label: t('component.received') },
			{ field: 'owner_id', label: t('component.receiver') }
		]}
	/>
{/snippet}
{#snippet receiptLines()}
	<Table
		of="goods_receipt_lines"
		key="receipt_lines"
		toolbar={{ title: t('app.crm_purchase.receipt_lines_title') }}
		columns={[
			{ field: 'goods_receipt_id', label: t('component.receipt') },
			{ field: 'purchase_order_line_id', label: t('component.order_line') },
			{ field: 'quantity_received', label: t('component.received') }
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
			{ field: 'doc_no', label: t('component.doc_no') },
			{ field: 'purchase_order_id', label: t('component.purchase_order') },
			{ field: 'supplier_name', label: t('component.supplier') },
			{ field: 'invoice_reference', label: t('component.supplier_no') },
			'status',
			{ field: 'gross', label: t('component.gross_amount') }
		]}
	/>
{/snippet}
{#snippet invoiceLines()}
	<Table
		of="purchase_invoice_lines"
		key="invoice_lines"
		toolbar={{ title: t('app.crm_purchase.invoice_lines_title') }}
		columns={[
			{ field: 'purchase_invoice_id', label: t('component.invoice') },
			{ field: 'product_code', label: t('component.code') },
			{ field: 'product_name', label: t('component.product') },
			'quantity',
			{ field: 'unit_cost', label: t('component.unit_cost') },
			{ field: 'line_total', label: t('component.total') }
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
			'currency',
			{ field: 'settled_on', label: t('component.settled_on') },
			'reference'
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:shopping-cart"
	title={t('app.crm_purchase.title')}
	description={t('app.crm_purchase.header_description')}
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
				name: 'po-lines',
				title: t('app.crm_purchase.tab_po_lines'),
				icon: 'lucide:list-checks',
				body: orderLines
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
				name: 'receipt-lines',
				title: t('app.crm_purchase.receipt_lines_title'),
				icon: 'lucide:list-checks',
				body: receiptLines
			},
			{
				name: 'purchase-invoices',
				title: t('app.crm_purchase.purchase_invoices_title'),
				icon: 'lucide:receipt',
				body: invoices
			},
			{
				name: 'pi-lines',
				title: t('app.crm_purchase.invoice_lines_title'),
				icon: 'lucide:list-checks',
				body: invoiceLines
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
