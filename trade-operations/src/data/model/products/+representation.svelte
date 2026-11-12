<script lang="ts">
	import { bolt } from '$bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { Chart, EmptyState, Show, useKinds, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { commercialSalesRead, salesDetail, salesRead } from '../../../lib/reports.js';
	let {
		view
	}: {
		view: RecordView<'products'>;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const kinds = useKinds();
	const sales = $derived.by(() => {
		if (!id || !kinds.catalog?.source_sales_lines) return null;
		const read =
			kinds.catalog.source_sales_lines.output === 'commercial' ? commercialSalesRead : salesRead;
		return bolt.query({
			...read,
			products: { ...read.products, where: { id: { eq: id } }, limit: 1 },
			sys_user: { ...read.sys_user, limit: 1 },
			source_sales_lines: {
				...read.source_sales_lines,
				where: {
					active: { eq: true },
					kind: { eq: 'shipment' },
					order: { is: { lines: { some: { product: { eq: id } } } } }
				},
				orderBy: { business_on: 'desc' },
				limit: 100
			}
		});
	});
	const rows = $derived(
		(sales?.current ? salesDetail(sales.current) : [])
			.filter((row) => row.product === id)
			.sort((a, b) => a.business_on.localeCompare(b.business_on))
	);
	const floors = $derived(
		id && kinds.catalog?.pricing_floors
			? bolt.query({
					pricing_floors: {
						where: { product: { eq: id } },
						fields: [
							'effective_on',
							'currency',
							'unit',
							'group_code',
							'minimum_quantity',
							'floor_price',
							'tax_inclusive',
							'tax_rate'
						],
						orderBy: { effective_on: 'desc' },
						limit: 100
					}
				})
			: null
	);
	const rates = $derived(
		floors?.current?.pricing_floors.rows
			.map((floor) => ({
				on: floor.effective_on,
				currency: floor.currency,
				unit: floor.unit,
				group: floor.group_code,
				threshold: floor.minimum_quantity,
				price: floor.tax_inclusive
					? floor.floor_price.div(Decimal.of(1).plus(floor.tax_rate.div(100, 8)), 8)
					: floor.floor_price
			}))
			.reverse() ?? []
	);
	const groups = $derived([...new Set(rows.map((r) => `${r.currency}/${r.unit}`))]);
</script>

{#snippet productDetails()}
	{#if view.mode !== 'create'}
		<Grid as="dl" gap="md">
			{#each ['external_code', 'name', 'spec', 'unit', 'currency', 'unit_price', 'tax_rate', 'active'] as const as name}
				{@const kind = kinds.catalog?.products?.fields[name]}
				{#if kind}<div data-field={name}>
						<dt class="text-xs font-medium text-muted-foreground">
							{bolt.t(`models.products.fields.${name}`)}
						</dt>
						<dd><Show {kind} value={view.record[name]} {name} row={view.record} /></dd>
					</div>{/if}
			{/each}
		</Grid>
	{/if}
{/snippet}
{#snippet pricing()}
	<Stack gap="lg">
		{#if id}
			{#each groups as group}
				<Chart
					of={rows
						.filter((r) => `${r.currency}/${r.unit}` === group)
						.map((r) => ({
							on: r.business_on,
							[bolt.t('component.sold_price')]:
								r.sold_price == null ? null : Decimal.of(r.sold_price).toString(),
							[bolt.t('models.pricing_floors.fields.floor_price')]:
								r.floor_net == null ? null : Decimal.of(r.floor_net).toString()
						}))}
					x="on"
					y={[
						bolt.t('component.sold_price'),
						...(rows.some((r) => `${r.currency}/${r.unit}` === group && r.floor_net !== null)
							? [bolt.t('models.pricing_floors.fields.floor_price')]
							: [])
					]}
					kind="scatter"
					title={`${bolt.t('component.pricing_history')} · ${group}`}
				/>
			{/each}
			{#if sales?.error}<EmptyState
					variant="inset"
					tone="danger"
					title={sales.error.message}
				/>{/if}
			{#if floors?.error}<EmptyState
					variant="inset"
					tone="danger"
					title={floors.error.message}
				/>{/if}
			{#if sales?.current?.source_sales_lines.next || floors?.current?.pricing_floors.next}
				<p class="text-sm text-muted-foreground">{bolt.t('reports.product.recent_prices')}</p>
			{/if}
			{#each [...new Set(rates.map((r) => `${r.currency}/${r.unit}/${r.group}/${r.threshold}`))] as group}
				{@const points = rates.filter(
					(r) => `${r.currency}/${r.unit}/${r.group}/${r.threshold}` === group
				)}
				{@const first = points[0]}
				<Chart
					of={points.map((r) => ({
						on: r.on,
						[bolt.t('models.pricing_floors.fields.floor_price')]: r.price.toString()
					}))}
					x="on"
					y={bolt.t('models.pricing_floors.fields.floor_price')}
					kind="line"
					interpolation="step"
					title={`${bolt.t('models.pricing_floors.label')} · ${first?.group ?? ''} · ${first?.currency ?? ''}/${first?.unit ?? ''}${first?.threshold.gt(0) ? ` · ≥ ${first.threshold}` : ''}`}
				/>
			{/each}
			{#if (sales?.loading || floors?.loading) && rows.length === 0 && rates.length === 0}
				<p class="text-sm text-muted-foreground" role="status">
					{bolt.t('component.pricing_history_loading')}
				</p>
			{:else if !sales?.error && !floors?.error && rows.length === 0 && rates.length === 0}
				<EmptyState variant="inset" title={bolt.t('component.pricing_history_empty')} />
			{/if}
		{/if}
	</Stack>
{/snippet}
<RecordForm
	{view}
	sections={[
		{
			name: 'product',
			fields: [],
			body: productDetails
		},
		{
			name: 'commission',
			icon: 'lucide:percent',
			title: bolt.t('component.commission'),
			fields: ['commission_factor', 'commission_basis_unit']
		}
	]}
	tabs={id && (kinds.catalog?.pricing_floors || kinds.catalog?.source_sales_lines)
		? [{ name: 'pricing', title: bolt.t('component.pricing_history'), body: pricing }]
		: []}
/>
