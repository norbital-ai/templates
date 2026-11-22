<script lang="ts">
	/**
	 * Where the hedges stand at today's official rate: live hedges' value, fixings needing the bank's rate, the next
	 * 14 days and the closest knock-out; the watch list; USD to exchange on firm fixings over the next six months; the
	 * live deals; and today's reference rates. Figures are a guide at the official rate, not the banks' valuations.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Chart,
		EmptyState,
		Icon,
		Table,
		TableSkeleton,
		format,
		open_record
	} from '@norbital-ai/ui';
	import { AppShell, Bound, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { addDays, addMonths } from '../../lib/calculations.js';
	import { dealView, FX_DEAL_READ, usdOn, watch, type FxSide } from '../../lib/fx.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const read = ctx.query(FX_DEAL_READ);
	const rates = $derived(read.current?.fx_rate.rows ?? []);
	const deals = $derived(
		(read.current?.fx_deal.rows ?? [])
			.filter((d) => d.status !== 'proposal')
			.map((d) => ({ deal: d, view: dealView(d, rates, day.today) }))
	);
	const live = $derived(deals.filter((d) => d.view.state === 'live'));
	const usd = (n: number | null) =>
		n === null
			? '—'
			: format({ kind: 'money' }, String(Math.round(n)), { locale: ctx.locale, currency: 'USD' });
	/** A fixing's amount in USD at today's rate: amounts printed in the quote currency are units of base at the strike. */
	const baseUsd = (
		deal: {
			readonly pair: string;
			readonly notional_currency: string | null;
			readonly strike: string | null;
		},
		amount: string | null,
		strike: string | null
	) => {
		const rate = usdOn(deal.pair.slice(0, 3), day.today, rates);
		const k = Number(strike ?? deal.strike ?? 0);
		if (amount === null || rate === null) return 0;
		const units =
			deal.notional_currency === null || deal.notional_currency === deal.pair.slice(0, 3)
				? Number(amount)
				: k > 0
					? Number(amount) / k
					: 0;
		return units * Number(rate);
	};
	const tiles = $derived.by(() => {
		const valued = live.filter((d) => d.view.position?.total_usd != null);
		const needs = deals.flatMap((d) => d.view.needsRate.map((f) => f.fixing_date)).sort();
		const soon = live.flatMap((d) =>
			d.view.open
				.filter((f) => f.fixing_date <= addDays(day.today, 14))
				.map((f) => ({
					firm: f.firm,
					usd: baseUsd(d.deal, f.notional ?? d.deal.notional, f.strike)
				}))
		);
		const ko = live
			.map((d) => d.view.position?.ko_distance_pct ?? null)
			.filter((x): x is number => x !== null);
		const closestKo = ko.length === 0 ? null : Math.min(...ko);
		return [
			{
				title: t('fx.tile.value'),
				value: usd(valued.reduce((s, d) => s + (d.view.position?.total_usd ?? 0), 0)),
				hint: t('fx.tile.value_hint', { live: live.length, valued: valued.length }),
				warn: false
			},
			{
				title: t('fx.tile.needs_rate'),
				value: String(needs.length),
				hint: needs[0] === undefined ? '' : t('fx.tile.oldest', { date: needs[0] }),
				warn: false
			},
			{
				title: t('fx.tile.next_14'),
				value: String(soon.length),
				hint: usd(soon.filter((s) => s.firm).reduce((s, x) => s + x.usd, 0)),
				warn: false
			},
			{
				title: t('fx.tile.closest_ko'),
				value: closestKo === null ? '—' : `${closestKo.toFixed(1)}%`,
				hint: '',
				warn: closestKo !== null && closestKo < 3
			}
		];
	});
	const watching = $derived(
		live
			.flatMap((d) =>
				watch(d.deal, d.view, day.today).map((w) => ({
					...w,
					deal: d.deal.id,
					name: `${d.deal.bank?.code ?? ''} ${d.deal.pair} ${t(`models.fx_deal.fields.structure.${d.deal.structure}`)}`
				}))
			)
			.sort((a, b) => Number(b.warn) - Number(a.warn))
	);
	const ladder = $derived(
		Array.from({ length: 6 }, (_, i) => addMonths(day.today, i).slice(0, 7)).map((month) => ({
			month,
			usd: String(
				Math.round(
					live.reduce(
						(s, d) =>
							s +
							d.view.open
								.filter((f) => f.firm && f.fixing_date.startsWith(month))
								.reduce((x, f) => x + baseUsd(d.deal, f.notional ?? d.deal.notional, f.strike), 0),
						0
					)
				)
			)
		}))
	);
	const table = $derived(
		live.map(({ deal, view }) => ({
			id: deal.id,
			bank: deal.bank?.code ?? '—',
			pair: deal.pair,
			structure: t(`models.fx_deal.fields.structure.${deal.structure}`),
			side: deal.side,
			strike: deal.strike,
			spot: view.spot === null ? null : view.spot.toFixed(4),
			left: view.open.length,
			value: view.position?.total_usd == null ? null : view.position.total_usd.toFixed(2)
		}))
	);
	const reference = $derived(
		['SGD', 'MYR', 'IDR', 'JPY', 'CNY', 'EUR']
			.map((c) => ({ currency: c, rate: usdOn(c, day.today, rates) }))
			.filter((r) => r.rate !== null)
			.map((r) => ({ currency: r.currency, per_usd: (1 / Number(r.rate)).toFixed(4) }))
	);
</script>

{#snippet sideCell({ value }: { value: FxSide | null | undefined })}
	{#if value === 'buy' || value === 'sell'}
		<Badge variant="outline">{t(`models.fx_deal.fields.side.${value}`)}</Badge>
	{:else}
		—
	{/if}
{/snippet}

<AppShell
	icon="lucide:layout-dashboard"
	title={t('fx.overview.title')}
	description={t('fx.overview.description')}
	variant="full"
>
	<Scroll name="fx-overview" size="fill" inset>
		{#if read.error}
			<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
		{:else if read.current === undefined}
			<Stack gap="lg" aria-busy="true">
				<Grid minimum="compact">
					{#each [0, 1, 2, 3] as i (i)}
						<div class="rounded-xl border border-border bg-card p-4">
							<Stack gap="xs">
								<div
									class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none"
									style="width:55%"
								></div>
								<div
									class="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none"
									style="width:70%"
								></div>
							</Stack>
						</div>
					{/each}
				</Grid>
				<TableSkeleton />
			</Stack>
		{:else if deals.length === 0}
			<EmptyState title={t('fx.overview.empty')} hint={t('fx.overview.empty_hint')} />
		{:else}
			<Stack gap="lg">
				<Grid minimum="compact">
					{#each tiles as tile (tile.title)}
						<div class="rounded-xl border border-border bg-card p-4">
							<Stack gap="xs">
								<p class="text-meta">{tile.title}</p>
								<p class="text-section tabular-nums">{tile.value}</p>
								{#if tile.warn}
									<div>
										<Badge variant="warning">
											<Inline gap="xs" align="center">
												<Icon name="lucide:triangle-alert" class="size-3" />
												<span>{t('fx.tile.ko_near')}</span>
											</Inline>
										</Badge>
									</div>
								{:else if tile.hint}
									<p class="text-meta">{tile.hint}</p>
								{/if}
							</Stack>
						</div>
					{/each}
				</Grid>
				{#if watching.length > 0}
					<Stack gap="sm">
						{#each watching as w, i (i)}
							<Alert.Root variant={w.warn ? 'warning' : 'default'}>
								<Alert.Description>
									<Inline
										as="button"
										type="button"
										gap="xs"
										align="center"
										class="text-left"
										onclick={() => open_record('fx_deal', w.deal)}
									>
										<Icon name={w.warn ? 'lucide:triangle-alert' : 'lucide:info'} class="size-4" />
										<span>{w.name}: {t(w.key, w.values)}</span>
									</Inline>
								</Alert.Description>
							</Alert.Root>
						{/each}
					</Stack>
				{/if}
				<div class="rounded-xl border border-border bg-card p-4">
					<Bound height="20rem">
						<Chart {ctx} of={ladder} x="month" y="usd" kind="bar" title={t('fx.overview.ladder')} />
					</Bound>
				</div>
				<div class="rounded-xl border border-border bg-card p-4">
					<Stack gap="sm">
						<h2 class="text-heading">{t('fx.overview.live_deals')}</h2>
						<Table
							{ctx}
							of={table}
							controlled
							embedded
							columns={[
								{ field: 'bank', label: t('fx.bank') },
								{ field: 'pair', label: t('fx.pair') },
								{ field: 'structure', label: t('fx.structure') },
								{ field: 'side', label: t('fx.side'), cell: sideCell },
								{
									field: 'strike',
									label: t('fx.strike'),
									kind: { kind: 'decimal', scale: 4 },
									align: 'end'
								},
								{
									field: 'spot',
									label: t('fx.spot'),
									kind: { kind: 'decimal', scale: 4 },
									align: 'end'
								},
								{
									field: 'left',
									label: t('fx.open_fixings'),
									kind: { kind: 'int' },
									align: 'end'
								},
								{
									field: 'value',
									label: t('fx.value_today'),
									kind: { kind: 'money', currency: 'USD' },
									align: 'end'
								}
							]}
							on_open={(row) => open_record('fx_deal', row.id)}
						/>
					</Stack>
				</div>
				{#if reference.length > 0}
					<div class="rounded-xl border border-border bg-card px-4 py-3">
						<Cluster gap="md" align="center" justify="between">
							<span class="text-meta">{t('fx.overview.reference_rates')}</span>
							<Cluster gap="md" align="center">
								{#each reference as r (r.currency)}
									<Inline gap="xs" align="baseline">
										<span class="text-meta">{r.currency}</span>
										<span class="text-sm tabular-nums">{r.per_usd}</span>
									</Inline>
								{/each}
							</Cluster>
						</Cluster>
					</div>
				{/if}
			</Stack>
		{/if}
	</Scroll>
</AppShell>
