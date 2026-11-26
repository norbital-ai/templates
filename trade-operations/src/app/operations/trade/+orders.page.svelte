<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { openCreate } from '../../../lib/ui/create-values.js';
	import OrderDocumentDialog from '../../../data/model/orders/order-document-dialog.svelte';
	import { downloadOrderPdfs } from '../../../data/model/orders/order-pdf.js';

	const actor = $derived(ctx.actor?.kind === 'member' ? ctx.actor : null);
	const canCreate = (direction: 'sales' | 'purchasing') =>
		ctx.catalog?.orders?.create &&
		(actor?.admin ||
			ctx.policies.includes('manager') ||
			ctx.policies.includes(direction === 'sales' ? 'sales' : 'procurement'));
	function newOrder(direction: 'sales' | 'purchasing') {
		openCreate('orders', { direction });
	}
	const purchaseOnly = $derived(
		Boolean(
			actor &&
			!actor.admin &&
			ctx.policies.includes('procurement') &&
			!ctx.policies.some((policy) => ['sales', 'manager', 'finance', 'logistics'].includes(policy))
		)
	);
	const showPurchase = $derived(
		Boolean(
			actor?.admin ||
			ctx.policies.some((policy) =>
				['procurement', 'manager', 'finance', 'logistics'].includes(policy)
			)
		)
	);
	let selectedOrder = $state<Id<'orders'> | null>(null);
	const day = ctx.clock('day');
</script>

{#snippet orders(direction: 'sales' | 'purchasing')}
	<Table
		{ctx}
		of="orders"
		where={{ direction: { eq: direction } }}
		initial_filter={{ active: { eq: true } }}
		columns={[
			'number',
			'title',
			'party',
			'status',
			...(ctx.catalog?.orders?.fields?.total ? (['total'] as const) : []),
			'owner'
		]}
		toolbar={{
			title: ctx.t(
				direction === 'purchasing' ? 'component.purchase_orders' : 'component.sales_orders'
			),
			new: canCreate(direction) ? () => newOrder(direction) : false,
			actions:
				ctx.catalog?.document_templates && ctx.catalog?.orders?.fields?.total
					? [
							{
								icon: 'lucide:eye',
								name: ctx.t('component.preview_document'),
								requires_selection: true,
								disabled: (ids) => (ids.length === 1 ? null : ctx.t('component.select_one_order')),
								run: (ids) => {
									selectedOrder = ids[0] ?? null;
								}
							},
							{
								icon: 'lucide:file-down',
								name: ctx.t('component.download_pdfs'),
								requires_selection: true,
								run: (ids) => downloadOrderPdfs(ctx, ids, `${direction}-orders-${day.today}.zip`)
							}
						]
					: []
		}}
	/>
{/snippet}
{#snippet sales()}{@render orders('sales')}{/snippet}
{#snippet purchases()}{@render orders('purchasing')}{/snippet}
<AppShell
	description={ctx.t('app.trade.description')}
	icon="lucide:clipboard-list"
	title={ctx.t('component.orders')}
	variant={showPurchase ? 'full' : 'page'}
>
	{#if showPurchase}
		<Tabs
			tabs={[
				...(purchaseOnly
					? []
					: [{ name: 'sales', title: ctx.t('component.sales_orders'), body: sales }]),
				{ name: 'purchasing', title: ctx.t('component.purchase_orders'), body: purchases }
			]}
		/>
	{:else}{@render sales()}{/if}
</AppShell>
{#if selectedOrder}
	<OrderDocumentDialog {ctx} order={selectedOrder} on_close={() => (selectedOrder = null)} />
{/if}
