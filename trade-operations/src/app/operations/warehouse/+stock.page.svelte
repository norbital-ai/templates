<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table, Tabs, type Col } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { downloadXlsx, xlsxWorkbook, type XlsxColumn } from '../../../lib/xlsx.js';
	import {
		logisticsStockAvailabilityRead,
		stockAvailability,
		stockAvailabilityRead
	} from '../../../lib/stock-availability.js';

	const clock = ctx.clock('minute');
	const day = ctx.clock('day');
	let tab = $state('products');
	const logistics = $derived(ctx.catalog?.stock_snapshots?.output === 'logistics');
	// each lot with what open sales orders await from its product in its warehouse, and what is left to sell
	const counted = $derived(Boolean(ctx.catalog?.source_stock_commitments));
	const inventory = $derived(
		counted && tab === 'stock'
			? logistics
				? ctx.query(logisticsStockAvailabilityRead)
				: ctx.query(stockAvailabilityRead)
			: null
	);
	const incomplete = $derived(
		Boolean(inventory?.current && Object.values(inventory.current).some((page) => page.next))
	);
	const lots = $derived.by(() => {
		const answer = inventory?.current;
		if (!answer) return null;
		const figures = new Map(
			stockAvailability(answer, Date.parse(clock.now), true).map((row) => [row.$id, row])
		);
		const products = new Map(answer.products.rows.map((row) => [row.id, row]));
		const warehouses = new Map(answer.warehouses.rows.map((row) => [row.id, row]));
		return answer.stock_snapshots.rows.map((lot) => {
			const figure = figures.get(JSON.stringify([lot.product, lot.warehouse]));
			return {
				id: lot.id,
				product: products.get(lot.product)?.name ?? '',
				warehouse: warehouses.get(lot.warehouse)?.name ?? '',
				lot_number: lot.lot_number,
				unit: lot.unit,
				on_hand: lot.on_hand,
				awaiting: figure?.awaiting ?? null,
				available: figure?.available ?? null,
				// cost only where the viewer's output carries it
				currency: 'currency' in lot && typeof lot.currency === 'string' ? lot.currency : null,
				unit_cost: 'unit_cost' in lot && typeof lot.unit_cost === 'string' ? lot.unit_cost : null,
				as_of: lot.as_of
			};
		});
	});
	const quantityKind = { kind: 'decimal', scale: 3, optional: true } as const;
	const lotColumns = $derived<readonly Col<NonNullable<typeof lots>[number]>[]>([
		{ field: 'product', label: ctx.t('models.stock_snapshots.fields.product') },
		{ field: 'warehouse', label: ctx.t('models.stock_snapshots.fields.warehouse') },
		{ field: 'lot_number', label: ctx.t('models.stock_snapshots.fields.lot_number') },
		{ field: 'unit', label: ctx.t('models.stock_snapshots.fields.unit') },
		...(['on_hand', 'awaiting', 'available'] as const).map((field) => ({
			field,
			label: ctx.t(`stock.availability.${field}`),
			kind: quantityKind,
			align: 'end' as const
		})),
		...(logistics
			? []
			: [
					{
						field: 'unit_cost' as const,
						label: ctx.t('models.stock_snapshots.fields.unit_cost'),
						kind: { kind: 'money', currency: 'currency', optional: true } as const,
						align: 'end' as const
					}
				]),
		{
			field: 'as_of',
			label: ctx.t('models.stock_snapshots.fields.as_of'),
			kind: { kind: 'instant' }
		}
	]);
	const productColumns = $derived<XlsxColumn[]>(
		logistics
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
		{ctx}
		of="products"
		columns={['external_code', 'name', 'unit', 'active']}
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
{#snippet stock()}{#if counted}<Table
			{ctx}
			layout="grid"
			of={lots ?? []}
			key="stock_snapshots"
			columns={lotColumns}
			toolbar={{
				// a stock past one read says so in the title, where it shifts nothing
				title: incomplete
					? `${ctx.t('models.stock_snapshots.label')} · ${ctx.t('stock.availability.incomplete')}`
					: ctx.t('models.stock_snapshots.label'),
				description: ctx.t('stock.availability.basis'),
				new: false,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('component.export_xlsx'),
						run: () => downloadXlsx('stock', day.today, lotColumns, lots ?? [])
					}
				]
			}}
		/>{:else}<Table
			{ctx}
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
		/>{/if}{/snippet}
{#snippet warehouses()}<Table
		{ctx}
		of="warehouses"
		columns={['external_code', 'name', 'group_code', 'active']}
		toolbar={{ new: false }}
	/>{/snippet}
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
			{ name: 'warehouses', title: ctx.t('models.warehouses.label'), body: warehouses }
		]}
	/></AppShell
>
