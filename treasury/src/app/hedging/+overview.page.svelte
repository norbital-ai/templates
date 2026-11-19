<script lang="ts">
	/**
	 * Where the hedges stand at today's official rate: live hedges' value, fixings needing the bank's rate, the next
	 * 14 days and the closest knock-out; the watch list; USD to exchange on firm fixings over the next six months; the
	 * live deals; and today's reference rates. Figures are a guide at the official rate, not the banks' valuations.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Chart, EmptyState, Table, open_record } from '@norbital-ai/ui';
	import { AppShell, Bound, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { addDays, addMonths } from '../../lib/calculations.js';
	import { dealView, FX_DEAL_READ, usdOn, watch } from '../../lib/fx.js';
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
		n === null ? '—' : `USD ${Math.round(n).toLocaleString(ctx.locale)}`;
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
		return [
			[
				t('fx.tile.value'),
				usd(valued.reduce((s, d) => s + (d.view.position?.total_usd ?? 0), 0)),
				t('fx.tile.value_hint', { live: live.length, valued: valued.length })
			],
			[
				t('fx.tile.needs_rate'),
				String(needs.length),
				needs[0] === undefined ? '' : t('fx.tile.oldest', { date: needs[0] })
			],
			[
				t('fx.tile.next_14'),
				String(soon.length),
				usd(soon.filter((s) => s.firm).reduce((s, x) => s + x.usd, 0))
			],
			[
				t('fx.tile.closest_ko'),
				ko.length === 0 ? '—' : `${Math.min(...ko).toFixed(1)}%`,
				Math.min(...ko) < 3 ? '▲' : ''
			]
		] as const;
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
			side: deal.side ?? '—',
			strike: deal.strike,
			spot: view.spot === null ? null : view.spot.toFixed(4),
			left: view.open.length,
			value: view.position?.total_usd == null ? null : view.position.total_usd.toFixed(0)
		}))
	);
	const reference = $derived(
		['SGD', 'MYR', 'IDR', 'JPY', 'CNY', 'EUR']
			.map((c) => ({ currency: c, rate: usdOn(c, day.today, rates) }))
			.filter((r) => r.rate !== null)
			.map((r) => ({ currency: r.currency, per_usd: (1 / Number(r.rate)).toFixed(4) }))
	);
</script>

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
			<EmptyState title={t('app.dashboard.loading')} />
		{:else if deals.length === 0}
			<EmptyState title={t('fx.overview.empty')} hint={t('fx.overview.empty_hint')} />
		{:else}
			<Stack gap="lg">
				<Grid minimum="compact">
					{#each tiles as [title, value, hint] (title)}
						<div class="rounded-xl border border-border bg-card p-4">
							<p class="text-meta">{title}</p>
							<p class="mt-1 text-xl font-semibold tabular-nums">{value}</p>
							<p class="text-meta">{hint}</p>
						</div>
					{/each}
				</Grid>
				{#if watching.length > 0}
					<Stack gap="sm">
						{#each watching as w, i (i)}
							<Alert.Root variant={w.warn ? 'warning' : 'default'}
								><Alert.Description
									><button class="text-left" onclick={() => open_record('fx_deal', w.deal)}
										>{w.warn ? '▲' : 'ℹ'} {w.name}: {t(w.key, w.values)}</button
									></Alert.Description
								></Alert.Root
							>
						{/each}
					</Stack>
				{/if}
				<Bound size="viewport"
					><Chart
						{ctx}
						of={ladder}
						x="month"
						y="usd"
						kind="bar"
						title={t('fx.overview.ladder')}
					/></Bound
				>
				<Table
					{ctx}
					of={table}
					controlled
					embedded
					columns={[
						{ field: 'bank', label: t('fx.bank') },
						{ field: 'pair', label: t('fx.pair') },
						{ field: 'structure', label: t('fx.structure') },
						{ field: 'side', label: t('fx.side') },
						{ field: 'strike', label: t('fx.strike'), kind: { kind: 'decimal', scale: 4 } },
						{ field: 'spot', label: t('fx.spot'), kind: { kind: 'decimal', scale: 4 } },
						{ field: 'left', label: t('fx.open_fixings'), kind: { kind: 'int' } },
						{ field: 'value', label: t('fx.value_today'), kind: { kind: 'decimal', scale: 0 } }
					]}
					on_open={(row) => open_record('fx_deal', row.id)}
				/>
				<Table
					{ctx}
					of={reference}
					controlled
					embedded
					columns={[
						{ field: 'currency', label: t('fx.currency') },
						{ field: 'per_usd', label: t('fx.per_usd'), kind: { kind: 'decimal', scale: 4 } }
					]}
				/>
			</Stack>
		{/if}
	</Scroll>
</AppShell>
