<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal } from 'effect';
	import { Chart, EmptyState, Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Bound, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { commercialSalesRead, salesDetail, salesRead } from '../../../lib/reports.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'products'>;
		ctx: PageContext;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const sales = $derived.by(() => {
		if (!id || !ctx.catalog?.source_sales_lines) return null;
		const read =
			ctx.catalog.source_sales_lines.output === 'commercial' ? commercialSalesRead : salesRead;
		return ctx.query({
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
				order_by: { business_on: 'desc' },
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
		id && ctx.catalog?.pricing_floors
			? ctx.query({
					pricing_floors: {
						where: { product: { eq: id } },
						fields: [
							'effective_on',
							'currency',
							'unit',
							'group_code',
							'floor_price',
							'tax_inclusive',
							'tax_rate'
						],
						order_by: { effective_on: 'desc' },
						limit: 200
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
				price: floor.tax_inclusive
					? BigDecimal.format(
							BigDecimal.round(
								BigDecimal.divideUnsafe(
									BigDecimal.fromStringUnsafe(floor.floor_price),
									BigDecimal.sum(
										BigDecimal.fromBigInt(1n),
										BigDecimal.round(
											BigDecimal.divideUnsafe(
												BigDecimal.fromStringUnsafe(floor.tax_rate),
												BigDecimal.fromBigInt(100n)
											),
											{ scale: 8 }
										)
									)
								),
								{ scale: 8 }
							)
						)
					: floor.floor_price
			}))
			.reverse() ?? []
	);
	const groups = $derived([...new Set(rows.map((r) => `${r.currency}/${r.unit}`))]);
	/** One multi-series step chart per currency/unit, plotting each warehouse region as its own line. */
	const floorCharts = $derived.by(() => {
		const byUnit = new Map<string, typeof rates>();
		for (const rate of rates) {
			const key = `${rate.currency}/${rate.unit}`;
			const bucket = byUnit.get(key) ?? [];
			bucket.push(rate);
			byUnit.set(key, bucket);
		}
		return [...byUnit.entries()].map(([unitKey, entries]) => {
			const regions = [...new Set(entries.map((e) => e.group))].sort();
			const dates = [...new Set(entries.map((e) => e.on))].sort();
			const byDayRegion = new Map(entries.map((e) => [`${e.on}|${e.group}`, e.price]));
			const carried = new Map<string, string>();
			const points = dates.map((on) => {
				const point: Record<string, string | null> = { on };
				for (const region of regions) {
					const fresh = byDayRegion.get(`${on}|${region}`);
					if (fresh !== undefined) carried.set(region, fresh);
					point[region] = carried.get(region) ?? null;
				}
				return point;
			});
			return { unitKey, regions, points };
		});
	});
</script>

{#snippet pricing()}
	<Scroll name="pricing" size="fill" inset
		><Stack gap="lg">
			{#if id}
				{#each groups as group (group)}
					<Bound height="20rem">
						<Chart
							{ctx}
							of={rows
								.filter((r) => `${r.currency}/${r.unit}` === group)
								.map((r) => ({
									on: r.business_on,
									[ctx.t('component.sold_price')]: r.sold_price,
									[ctx.t('models.pricing_floors.fields.floor_price')]: r.floor_net
								}))}
							x="on"
							y={[
								ctx.t('component.sold_price'),
								...(rows.some((r) => `${r.currency}/${r.unit}` === group && r.floor_net !== null)
									? [ctx.t('models.pricing_floors.fields.floor_price')]
									: [])
							]}
							kind="scatter"
							title={`${ctx.t('component.pricing_history')} · ${group}`}
						/>
					</Bound>
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
					<p class="text-sm text-muted-foreground">{ctx.t('reports.product.recent_prices')}</p>
				{/if}
				{#each floorCharts as chart (chart.unitKey)}
					<Bound height="20rem">
						<Chart
							{ctx}
							of={chart.points}
							x="on"
							y={chart.regions}
							kind="line"
							interpolation="step"
							title={`${ctx.t('models.pricing_floors.label')} · ${chart.unitKey}`}
						/>
					</Bound>
				{/each}
				{#if (sales?.loading || floors?.loading) && rows.length === 0 && rates.length === 0}
					<p class="text-sm text-muted-foreground" role="status">
						{ctx.t('component.pricing_history_loading')}
					</p>
				{:else if !sales?.error && !floors?.error && rows.length === 0 && rates.length === 0}
					<EmptyState variant="inset" title={ctx.t('component.pricing_history_empty')} />
				{/if}
			{/if}
		</Stack></Scroll
	>
{/snippet}
<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm
	{ctx}
	{view}
	lock={ctx.t('component.kingdee_readonly')}
	tabs={id && (ctx.catalog?.pricing_floors || ctx.catalog?.source_sales_lines)
		? [{ name: 'pricing', title: ctx.t('component.pricing_history'), body: pricing }]
		: []}
>
	<Section first name="product">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="external_code" />
			<Field {ctx} name="source_number" />
			<Field {ctx} name="name" />
			<Field {ctx} name="category" />
			<Field {ctx} name="spec" />
			<Field {ctx} name="brand" />
			<Field {ctx} name="brand_en" />
			<Field {ctx} name="producing_area" />
			<Field {ctx} name="unit" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="unit_price" />
			<Field {ctx} name="tax_rate" />
			<Field {ctx} name="active" />
		</Grid>
	</Section>
</RecordForm>
