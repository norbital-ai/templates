<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { EmptyState, Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { xlsxWorkbook, type XlsxColumn } from '../../../lib/xlsx.js';
	import {
		logisticsStockAvailabilityRead,
		stockAvailability,
		stockAvailabilityRead
	} from '../../../lib/stock-availability.js';

	const clock = ctx.clock('minute');
	let tab = $state('products');
	let view = $state<'product' | 'warehouse'>('product');
	const shown = $derived(Boolean(ctx.catalog?.source_stock_commitments));
	const availability = $derived(
		shown && tab === 'availability'
			? ctx.catalog?.products?.output === 'logistics'
				? ctx.query(logisticsStockAvailabilityRead)
				: ctx.query(stockAvailabilityRead)
			: null
	);
	const incomplete = $derived(
		availability?.current && Object.values(availability.current).some((page) => page.next)
	);
	const rows = $derived(
		availability?.current && !incomplete
			? stockAvailability(availability.current, Date.parse(clock.now), view === 'warehouse').map(
					(row) => ({ ...row, warehouse: row.warehouse ?? ctx.t('stock.availability.unassigned') })
				)
			: null
	);
	const quantities = ['on_hand', 'awaiting', 'available'] as const;
	const quantityKind = { kind: 'decimal', scale: 3, optional: true } as const;
	const productColumns = $derived<XlsxColumn[]>(
		ctx.catalog?.products?.output === 'logistics'
			? [
					{ field: 'external_code', label: ctx.t('models.products.fields.external_code') },
					{ field: 'name', label: ctx.t('models.products.fields.name') },
					{ field: 'spec', label: ctx.t('models.products.fields.spec') },
					{ field: 'producing_area', label: ctx.t('models.products.fields.producing_area') },
					{ field: 'brand', label: ctx.t('models.products.fields.brand') },
					{ field: 'brand_en', label: ctx.t('models.products.fields.brand_en') },
					{ field: 'unit', label: ctx.t('models.products.fields.unit') },
					{ field: 'active', label: ctx.t('models.products.fields.active') }
				]
			: [
					{ field: 'external_code', label: ctx.t('models.products.fields.external_code') },
					{ field: 'source_number', label: ctx.t('models.products.fields.source_number') },
					{ field: 'name', label: ctx.t('models.products.fields.name') },
					{ field: 'spec', label: ctx.t('models.products.fields.spec') },
					{ field: 'producing_area', label: ctx.t('models.products.fields.producing_area') },
					{ field: 'brand', label: ctx.t('models.products.fields.brand') },
					{ field: 'brand_en', label: ctx.t('models.products.fields.brand_en') },
					{ field: 'unit', label: ctx.t('models.products.fields.unit') },
					{ field: 'currency', label: ctx.t('models.products.fields.currency') },
					{
						field: 'unit_price',
						label: ctx.t('models.products.fields.unit_price'),
						numeric: true,
						scale: 4
					},
					{
						field: 'tax_rate',
						label: ctx.t('models.products.fields.tax_rate'),
						numeric: true,
						scale: 2
					},
					{
						field: 'commission_factor',
						label: ctx.t('models.products.fields.commission_factor'),
						numeric: true,
						scale: 6
					},
					{
						field: 'commission_basis_unit',
						label: ctx.t('models.products.fields.commission_basis_unit')
					},
					{ field: 'active', label: ctx.t('models.products.fields.active') }
				]
	);
	async function exportProducts() {
		const logistics = ctx.catalog?.products?.output === 'logistics';
		const answer = logistics
			? await ctx.query({
					products: {
						output: 'logistics',
						fields: [
							'external_code',
							'name',
							'spec',
							'producing_area',
							'brand',
							'brand_en',
							'unit',
							'active'
						],
						limit: 10000
					}
				})
			: await ctx.query({
					products: {
						fields: [
							'external_code',
							'source_number',
							'name',
							'spec',
							'producing_area',
							'brand',
							'brand_en',
							'unit',
							'currency',
							'unit_price',
							'tax_rate',
							'commission_factor',
							'commission_basis_unit',
							'active'
						],
						limit: 10000
					}
				});
		const bytes = xlsxWorkbook('products', productColumns, answer.products.rows);
		const url = URL.createObjectURL(
			new Blob([bytes], {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'products.xlsx';
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

{#snippet products()}<Table
		of="products"
		columns={['external_code', 'name', 'unit', 'unit_price', 'active']}
		toolbar={{
			new: false,
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => void exportProducts()
				}
			]
		}}
	/>{/snippet}
{#snippet stock()}<Table
		layout="grid"
		of="stock_snapshots"
		columns={[
			'product',
			'warehouse',
			'lot_number',
			'unit',
			'on_hand',
			'currency',
			'unit_cost',
			'as_of'
		]}
		toolbar={{ new: false, export: true }}
	/>{/snippet}
{#snippet warehouses()}<Table
		of="warehouses"
		columns={['external_code', 'name', 'group_code', 'active']}
	/>{/snippet}
{#snippet availabilityControls()}
	<label class="flex items-center gap-2 text-sm">
		{ctx.t('stock.availability.view')}
		<select bind:value={view} class="h-9 rounded-md border border-input bg-background px-2">
			<option value="product">{ctx.t('models.products.label')}</option>
			<option value="warehouse">{ctx.t('models.warehouses.label')}</option>
		</select>
	</label>
{/snippet}
{#snippet sellable()}
	{#if availability?.error}
		<EmptyState title={availability.error.message} tone="danger" />
	{:else if incomplete}
		<EmptyState title={ctx.t('stock.availability.incomplete')} tone="danger" />
	{:else if rows?.length}
		<Table
			layout="grid"
			of={rows}
			key={view === 'warehouse' ? 'stock-by-warehouse' : 'stock-by-product'}
			columns={[
				{ field: 'product', label: ctx.t('models.products.singular'), width: 124 },
				...(view === 'warehouse'
					? [
							{
								field: 'warehouse' as const,
								label: ctx.t('models.stock_snapshots.fields.warehouse'),
								width: 142
							}
						]
					: []),
				...quantities.map((field) => ({
					field,
					label: ctx.t(`stock.availability.${field}`),
					kind: quantityKind,
					width: field === 'awaiting' ? 176 : field === 'available' ? 122 : 106,
					align: 'end' as const
				})),
				{ field: 'unit', label: ctx.t('models.stock_snapshots.fields.unit'), width: 88 },
				...(view === 'warehouse'
					? [
							{
								field: 'warehouse_group' as const,
								label: ctx.t('stock.availability.warehouse_group')
							}
						]
					: []),
				{ field: 'code', label: ctx.t('models.products.fields.external_code') },
				{ field: 'ledger', label: ctx.t('reports.aging.ledger') },
				{
					field: 'stock_as_of',
					label: ctx.t('stock.availability.stock_as_of'),
					kind: { kind: 'instant', optional: true }
				},
				{
					field: 'orders_as_of',
					label: ctx.t('stock.availability.orders_as_of'),
					kind: { kind: 'instant', optional: true }
				}
			]}
			toolbar={{
				new: false,
				export: true,
				description: ctx.t(
					view === 'warehouse' ? 'stock.availability.warehouse_basis' : 'stock.availability.basis'
				),
				controls: availabilityControls
			}}
		/>
	{:else if rows}
		<EmptyState title={ctx.t('stock.availability.empty')} />
	{:else}
		<EmptyState title={ctx.t('component.reports_loading')} />
	{/if}
{/snippet}
<AppShell
	description={ctx.t('app.warehouse.description')}
	icon="lucide:package"
	title={ctx.t('component.stock')}
	variant="full"
	><Tabs
		value={tab}
		on_value_change={(value) => (tab = value)}
		tabs={[
			{ name: 'products', title: ctx.t('models.products.label'), body: products },
			{ name: 'stock', title: ctx.t('models.stock_snapshots.label'), body: stock },
			...(shown
				? [{ name: 'availability', title: ctx.t('stock.availability.title'), body: sellable }]
				: []),
			{ name: 'warehouses', title: ctx.t('models.warehouses.label'), body: warehouses }
		]}
	/></AppShell
>
