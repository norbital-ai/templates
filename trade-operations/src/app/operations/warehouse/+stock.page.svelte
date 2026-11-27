<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Badge, Show, Table, Tabs, type Col } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import {
		downloadWorkbook,
		downloadXlsx,
		xlsxWorkbook,
		type XlsxColumn
	} from '../../../lib/xlsx.js';
	import {
		logisticsStockAvailabilityRead,
		stockAvailability,
		stockAvailabilityRead
	} from '../../../lib/stock-availability.js';
	import { displayUnit, priceToDisplay, qtyToDisplay } from '../../../lib/unit-display.js';

	const clock = ctx.clock('minute');
	const day = ctx.clock('day');
	let tab = $state('products');
	const logistics = $derived(ctx.catalog?.stock_snapshots?.output === 'logistics');
	// each SKU per warehouse region: on hand, what open orders promise out and in, and the balance they leave
	const inventory = $derived(
		tab === 'stock'
			? logistics
				? ctx.query(logisticsStockAvailabilityRead)
				: ctx.query(stockAvailabilityRead)
			: null
	);
	const incomplete = $derived(
		Boolean(inventory?.current && Object.values(inventory.current).some((page) => page.next))
	);
	const rows = $derived(
		inventory?.current
			? stockAvailability(inventory.current, Date.parse(clock.now))
					.map((row) => ({
						...row,
						region: row.region ?? ctx.t('stock.availability.no_region'),
						unit: displayUnit(row.unit, ctx.locale) || row.unit,
						on_hand: qtyToDisplay(row.on_hand, row.unit),
						promised_out: qtyToDisplay(row.promised_out, row.unit),
						promised_in: qtyToDisplay(row.promised_in, row.unit),
						projected: qtyToDisplay(row.projected, row.unit)
					}))
					.sort((a, b) => a.region.localeCompare(b.region) || a.code.localeCompare(b.code))
			: null
	);
	const quantityKind = { kind: 'decimal', scale: 3, optional: true } as const;
	const stockColumns = $derived<readonly Col<NonNullable<typeof rows>[number]>[]>([
		{ field: 'region', label: ctx.t('models.warehouses.fields.group_code') },
		{ field: 'code', label: ctx.t('models.products.fields.external_code') },
		{ field: 'product', label: ctx.t('models.stock_snapshots.fields.product') },
		{ field: 'unit', label: ctx.t('models.stock_snapshots.fields.unit') },
		...(['on_hand', 'promised_out', 'promised_in'] as const).map((field) => ({
			field,
			label: ctx.t(`stock.availability.${field}`),
			kind: quantityKind,
			align: 'end' as const
		})),
		{
			field: 'projected',
			label: ctx.t('stock.availability.projected'),
			kind: quantityKind,
			align: 'end' as const,
			cell: projectedCell
		},
		{
			field: 'stock_as_of',
			label: ctx.t('models.stock_snapshots.fields.as_of'),
			kind: { kind: 'instant', optional: true }
		}
	]);
	const productColumns = $derived<XlsxColumn[]>(
		logistics
			? [
					{ field: 'external_code', label: ctx.t('models.products.fields.external_code') },
					{ field: 'name', label: ctx.t('models.products.fields.name') },
					{ field: 'category', label: ctx.t('models.products.fields.category') },
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
					{ field: 'category', label: ctx.t('models.products.fields.category') },
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
							'category',
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
							'category',
							'spec',
							'producing_area',
							'brand',
							'brand_en',
							'unit',
							'currency',
							'unit_price',
							'tax_rate',
							'active'
						],
						limit: 10000
					}
				});
		const mapped = answer.products.rows.map((row) => ({
			...row,
			unit: displayUnit(row.unit, ctx.locale) || row.unit,
			...('unit_price' in row && (typeof row.unit_price === 'string' || row.unit_price === null)
				? { unit_price: priceToDisplay(row.unit_price, row.unit) }
				: {})
		}));
		const bytes = xlsxWorkbook('products', productColumns, mapped);
		downloadWorkbook('products.xlsx', bytes);
	}
</script>

{#snippet unitCell({ value }: { value: unknown })}{displayUnit(
		typeof value === 'string' ? value : null,
		ctx.locale
	) || '—'}{/snippet}
{#snippet products()}<Table
		{ctx}
		of="products"
		columns={[
			'external_code',
			'name',
			'category',
			{ field: 'unit', label: ctx.t('models.products.fields.unit'), cell: unitCell },
			'active'
		]}
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
{#snippet projectedCell({ row }: { row: NonNullable<typeof rows>[number] })}<span
		class="tabular-nums"><Show {ctx} kind={quantityKind} value={row.projected} /></span
	>{#if row.short}
		<Badge variant="destructive">{ctx.t('stock.availability.short')}</Badge>{/if}{/snippet}
{#snippet stock()}<Table
		{ctx}
		layout="grid"
		of={rows ?? []}
		key="stock_regions"
		columns={stockColumns}
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
					run: () => downloadXlsx('stock', day.today, stockColumns, rows ?? [])
				}
			]
		}}
	/>{/snippet}
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
