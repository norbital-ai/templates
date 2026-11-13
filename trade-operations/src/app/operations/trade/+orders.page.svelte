<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { openCreate } from '../../../lib/ui/create-values.js';
	import OrderDocumentDialog from '../../../data/model/orders/order-document-dialog.svelte';

	const actor = $derived(ctx.actor?.kind === 'member' ? ctx.actor : null);
	const canCreate = (direction: 'sales' | 'purchasing') =>
		ctx.catalog?.orders?.create &&
		(actor?.admin ||
			actor?.teams.includes('commercial_managers') ||
			actor?.teams.includes(direction === 'sales' ? 'sales' : 'procurement'));
	async function newOrder(direction: 'sales' | 'purchasing') {
		const settings = await ctx
			.query({
				commercial_settings: {
					where: { code: { eq: 'default' } },
					fields: ['default_document_layout', 'default_purchase_document_layout'],
					limit: 1
				}
			})
			.then(
				(answer) => answer.commercial_settings.rows[0],
				() => undefined
			);
		const layout =
			direction === 'purchasing'
				? (settings?.default_purchase_document_layout ?? settings?.default_document_layout)
				: settings?.default_document_layout;
		openCreate('orders', {
			direction,
			...(layout ? { document_template: layout } : {}),
			...(direction === 'purchasing' ? { payment_terms: '' } : {})
		});
	}
	const purchaseOnly = $derived(
		Boolean(
			actor &&
			!actor.admin &&
			actor.teams.includes('procurement') &&
			!actor.teams.some((team) =>
				['sales', 'commercial_managers', 'finance', 'logistics'].includes(team)
			)
		)
	);
	const showPurchase = $derived(
		Boolean(
			actor?.admin ||
			actor?.teams.some((team) =>
				['procurement', 'commercial_managers', 'finance', 'logistics'].includes(team)
			)
		)
	);
	let selectedOrder = $state<Id<'orders'> | null>(null);
</script>

{#snippet orders(direction: 'sales' | 'purchasing')}
	<Table
		{ctx}
		of="orders"
		where={{ direction: { eq: direction } }}
		hidden_where={{ archived: { eq: false } }}
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
	variant="full"
>
	{#if purchaseOnly}{@render purchases()}
	{:else if showPurchase}
		<Tabs
			tabs={[
				{ name: 'sales', title: ctx.t('component.sales_orders'), body: sales },
				{ name: 'purchasing', title: ctx.t('component.purchase_orders'), body: purchases }
			]}
		/>
	{:else}{@render sales()}{/if}
</AppShell>
{#if selectedOrder}
	<OrderDocumentDialog {ctx} order={selectedOrder} on_close={() => (selectedOrder = null)} />
{/if}
