<script lang="ts">
	import { run, bolt } from '$bolt';
	import { Effect } from 'effect';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { Chart, Table, Show, useKinds, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { salesDetail, salesRead } from '../../../lib/reports.js';
	let {
		view
	}: {
		view: RecordView<'products'>;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const kinds = useKinds();
	const sales = $derived(id && kinds.catalog?.source_sales_lines ? bolt.query(salesRead) : null);
	const rows = $derived(
		(sales?.current ? salesDetail(sales.current) : [])
			.filter((r) => r.product === id && r.kind !== 'return')
			.sort((a, b) => a.business_on.localeCompare(b.business_on))
	);
	const floors = $derived(
		id ? bolt.query({ pricing_floors: { where: { product: { eq: id } } } }) : null
	);
	const floorPage = $derived(floors?.current?.pricing_floors);
	const loadFloorHistory = Effect.fnUntraced(function* (current: NonNullable<typeof floorPage>) {
		const rows = yield* Effect.forEach(
			current.rows,
			(floor) =>
				Effect.gen(function* () {
					const revisions = yield* bolt.history('pricing_floors', floor.id);
					return yield* Effect.forEach(
						revisions,
						(revision) =>
							Effect.gen(function* () {
								// the floor as this revision left it
								const [rate] = (yield* bolt.query({
									pricing_floors: { where: { id: { eq: floor.id } }, limit: 1, asOf: revision.at }
								})).pricing_floors.rows;
								if (!rate) return null;
								const value = Decimal.of(String(rate.floor_price)).div(
									rate.tax_inclusive
										? Decimal.of(1).plus(Decimal.of(String(rate.tax_rate)).div(100, 8))
										: Decimal.of(1),
									8
								);
								const date =
									revision.revision === 1
										? PlainDate(rate.effective_on).toString()
										: [
												PlainDate(rate.effective_on).toString(),
												revision.at?.slice(0, 10) ?? PlainDate(rate.effective_on).toString()
											]
												.sort()
												.at(-1)!;
								return {
									on: date,
									currency: rate.currency,
									unit: rate.unit,
									group: rate.group_code,
									threshold: Decimal.of(String(rate.minimum_quantity)).toString(),
									price: value.toString()
								};
							}),
						{ concurrency: 'unbounded' }
					);
				}),
			{ concurrency: 'unbounded' }
		);
		return rows.flat().filter((row) => row !== null);
	});
	// the revisions behind the current floors: re-read whenever the floors page changes
	const floorHistory = $derived(floorPage == null ? null : run(loadFloorHistory(floorPage)));
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
			{#if sales?.error}<p role="alert">
					{sales.error.message}
				</p>{/if}
			{#if floors?.error}<p role="alert">{floors.error.message}</p>{/if}
			{#if floorHistory}
				{#await floorHistory}<p role="status">
						{bolt.t('component.pricing_history_loading')}
					</p>{:then rates}
					{#each [...new Set(rates.map((r) => `${r.currency}/${r.unit}/${r.group}/${r.threshold}`))] as group}
						{@const first = rates.find(
							(r) => `${r.currency}/${r.unit}/${r.group}/${r.threshold}` === group
						)!}
						<Chart
							of={rates
								.filter((r) => `${r.currency}/${r.unit}/${r.group}/${r.threshold}` === group)
								.map((r) => ({
									on: r.on,
									[bolt.t('models.pricing_floors.fields.floor_price')]: r.price
								}))}
							x="on"
							y={bolt.t('models.pricing_floors.fields.floor_price')}
							kind="line"
							interpolation="step"
							title={[
								bolt.t('models.pricing_floors.label'),
								`${first.currency}/${first.unit}`,
								first.group,
								Decimal.of(first.threshold).gt(0)
									? `${bolt.t('models.pricing_floors.fields.minimum_quantity')}: ${first.threshold} ${first.unit}`
									: ''
							]
								.filter(Boolean)
								.join(' · ')}
						/>
					{/each}
				{:catch}<p role="alert">
						{bolt.t('component.confirmation_error')}
					</p>{/await}
			{/if}

			<Table
				of="pricing_floors"
				where={{ product: { eq: id } }}
				columns={[
					'effective_on',
					'group_code',
					'unit',
					'currency',
					'floor_price',
					'minimum_quantity'
				]}
				toolbar={{ new: false }}
			/>
		{/if}
	</Stack>
{/snippet}
<RecordForm
	{view}
	mainTitle={bolt.t('section.general')}
	sections={[
		{
			name: 'product',
			fields: [],
			body: productDetails
		},
		{
			name: 'commission',
			title: bolt.t('component.commission'),
			fields: ['commission_factor', 'commission_basis_unit']
		}
	]}
	tabs={id && kinds.catalog?.pricing_floors
		? [{ name: 'pricing', title: bolt.t('component.pricing_history'), body: pricing }]
		: []}
/>
