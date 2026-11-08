<script lang="ts">
	import { type RowIn, type ColumnsIn, Table, Tabs, useKinds, Show } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { openCreate } from '../../../lib/ui/create-values.js';
	import OrderDocumentDialog from '../../../data/model/orders/order-document-dialog.svelte';

	const kinds = useKinds();
	const actor = $derived(bolt.actor?.kind === 'member' ? bolt.actor : null);
	const canCreate = (direction: 'sales' | 'purchasing') =>
		kinds.catalog?.orders?.create &&
		(actor?.admin ||
			actor?.teams.includes('commercial_managers') ||
			actor?.teams.includes(direction === 'sales' ? 'sales' : 'procurement'));
	async function newOrder(direction: 'sales' | 'purchasing') {
		const settings = await bolt
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

<!-- a draft shows its lines' total; an agreed order its current contract's -->
{#snippet orderTotal({
	row,
	value
}: {
	row: RowIn<'orders'>;
	value: ColumnsIn<'orders'>['agreed_total'] | undefined;
})}<Show
		kind={{ kind: 'money', currency: 'currency' }}
		value={(row.status !== 'draft' || row.draft_setup) && value != null ? value : row.total}
		{row}
	/>{/snippet}
{#snippet orders(direction: 'sales' | 'purchasing')}
	<Table
		of="orders"
		where={{ direction: { eq: direction } }}
		hiddenWhere={{ archived: { eq: false } }}
		columns={[
			'number',
			'title',
			'party',
			'status',
			...(kinds.catalog?.orders?.fields?.agreed_total
				? [
						{
							field: 'agreed_total' as const,
							label: bolt.t('models.orders.fields.total'),
							align: 'end' as const,
							cell: orderTotal
						}
					]
				: []),
			'owner'
		]}
		toolbar={{
			title: bolt.t(
				direction === 'purchasing' ? 'component.purchase_orders' : 'component.sales_orders'
			),
			new: canCreate(direction) ? () => newOrder(direction) : false,
			actions:
				kinds.catalog?.document_templates && kinds.catalog?.orders?.fields?.sealed_snapshot
					? [
							{
								icon: 'lucide:eye',
								name: bolt.t('component.preview_document'),
								requiresSelection: true,
								disabled: (ids) => (ids.length === 1 ? null : bolt.t('component.select_one_order')),
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
	description={bolt.t('app.trade.description')}
	icon="lucide:clipboard-list"
	title={bolt.t('component.orders')}
	variant="full"
>
	{#if purchaseOnly}{@render purchases()}
	{:else if showPurchase}
		<Tabs
			tabs={[
				{ name: 'sales', title: bolt.t('component.sales_orders'), body: sales },
				{ name: 'purchasing', title: bolt.t('component.purchase_orders'), body: purchases }
			]}
		/>
	{:else}{@render sales()}{/if}
</AppShell>
{#if selectedOrder}
	<OrderDocumentDialog order={selectedOrder} onClose={() => (selectedOrder = null)} />
{/if}
