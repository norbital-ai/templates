<script lang="ts">
	/**
	 * Where the group stands: limit, used, available and earmarked across the banks, usage per bank, what falls due,
	 * the cost of funds now, over a chosen period and month by month, and the latest month-end status.
	 * Every figure is USD and comes from one read of the facilities and lines plus the shared treasury helpers.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Chart,
		Combobox,
		EmptyState,
		Icon,
		Label,
		Table,
		TableSkeleton,
		TimeInput,
		TimeRangeInput,
		format,
		value_object,
		type Value
	} from '@norbital-ai/ui';
	import { AppShell, Bound, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { addDays, addMonths, monthEnd, monthStart } from '../../lib/calculations.js';
	import {
		FACILITY_FIELDS,
		LINE_FIELDS,
		costOfFundsTrend,
		maturities,
		maturityLadder,
		periodCost,
		simpleRate,
		utilisation,
		weightedRate
	} from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const months = new Intl.DateTimeFormat(ctx.locale, {
		month: 'short',
		year: '2-digit',
		timeZone: 'UTC'
	});
	/** A `YYYY-MM` month as the locale names it. */
	const monthLabel = (month: string) => months.format(new Date(`${month}-01T00:00:00Z`));
	const shortMonth = new Intl.DateTimeFormat(ctx.locale, { month: 'short', timeZone: 'UTC' });
	/** Show the year only on the first tick and January so chart axes stay uncluttered. */
	const axisMonth = (month: string, first: boolean) =>
		first || month.endsWith('-01')
			? monthLabel(month)
			: shortMonth.format(new Date(`${month}-01T00:00:00Z`));
	const day = ctx.clock('day');
	let picked = $state<string | null>(null);
	const as_of = $derived(picked ?? day.today);

	const read = ctx.query({
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		drawdown: {
			where: { status: { in: ['earmarked', 'applied', 'active', 'settled'] } },
			fields: [...LINE_FIELDS]
		},
		month_end: {
			order_by: { month: 'desc' },
			limit: 1,
			fields: ['month', 'source', 'is_locked']
		},
		purchase_order: {
			where: { lc_requested: { eq: true }, is_cancelled: { eq: false } },
			fields: ['po_number'],
			financings: { fields: [], drawdown: { fields: ['product', 'lc_number'] } }
		}
	});
	const facilities = $derived(read.current?.facility.rows ?? []);
	const incomplete = $derived(
		[read.current?.facility, read.current?.drawdown, read.current?.purchase_order].some(
			(page) => page?.next != null
		)
	);
	const lines = $derived(read.current?.drawdown.rows ?? []);
	const open = $derived(lines.filter((l) => l.status === 'applied' || l.status === 'active'));
	const usage = $derived(utilisation(facilities, lines));
	const banks = $derived(new Map(facilities.map((f) => [f.id, f.bank?.code ?? '—'])));
	const due = $derived(maturities(lines, as_of));
	const ladder = $derived(
		maturityLadder(lines, as_of).map((r) => ({
			...r,
			month:
				r.month === 'earlier' || r.month === 'later'
					? t(r.month === 'earlier' ? 'app.dashboard.earlier' : 'app.dashboard.later')
					: axisMonth(r.month, r.month === as_of.slice(0, 7))
		}))
	);
	const trend = $derived(
		costOfFundsTrend(lines, as_of).map((point, index) => ({
			...point,
			month: axisMonth(point.month, index === 0)
		}))
	);
	const latest = $derived(read.current?.month_end.rows[0]);

	// the cost-of-funds period: quick picks counted from the as-of day; the financial year starts 1 April
	const fy = $derived(
		`${Number(as_of.slice(0, 4)) - (Number(as_of.slice(5, 7)) < 4 ? 1 : 0)}-04-01`
	);
	const thisMonth = $derived({
		value: 'month',
		label: t('app.dashboard.this_month'),
		from: monthStart(as_of),
		to: as_of
	});
	const picks = $derived([
		thisMonth,
		{
			value: 'last_month',
			label: t('app.dashboard.last_month'),
			from: monthStart(addMonths(as_of, -1)),
			to: monthEnd(addMonths(as_of, -1))
		},
		{
			value: 'quarter',
			label: t('app.dashboard.last_quarter'),
			from: addMonths(as_of, -3),
			to: as_of
		},
		{ value: 'fy', label: t('app.dashboard.financial_year'), from: fy, to: as_of },
		{
			value: 'year',
			label: t('app.dashboard.last_12_months'),
			from: addDays(as_of, -364),
			to: as_of
		}
	]);
	let period = $state('month');
	let selectedRange = $state<Value>(null);
	const customRange = $derived(
		value_object(selectedRange) &&
			typeof selectedRange.from === 'string' &&
			typeof selectedRange.to === 'string'
			? { from: selectedRange.from, to: selectedRange.to }
			: null
	);
	const window = $derived(customRange ?? picks.find((p) => p.value === period) ?? thisMonth);
	const cost = $derived(periodCost(lines, banks, window.from, window.to));
	const costAll = $derived(cost.find((c) => c.bank === 'all'));

	const usd = (value: string | null | undefined) =>
		value == null ? '—' : format({ kind: 'money' }, value, { locale: ctx.locale, currency: 'USD' });
	const rate = (value: string | null) => (value === null ? '—' : `${Number(value).toFixed(2)}%`);
	const tiles = $derived([
		{ title: t('app.dashboard.used'), value: usd(usage.total.used) },
		{ title: t('app.dashboard.available'), value: usd(usage.total.available) },
		{ title: t('app.dashboard.earmarked'), value: usd(usage.total.earmarked) },
		{ title: t('app.dashboard.free_after_earmarks'), value: usd(usage.total.free_after_earmarks) }
	]);
	const highBanks = $derived(usage.banks.filter((bank) => bank.high));
	const lcsToOpen = $derived(
		read.current?.purchase_order.rows.filter(
			(po) =>
				!po.financings.some((f) => f.drawdown?.product === 'lc' || f.drawdown?.lc_number != null)
		).length ?? 0
	);
	// Bar widths alone are capped; the financial values remain the exact shared helper results.
	const barPart = (amount: string, limit: string) =>
		Number(limit) > 0 ? Math.max(0, Math.min(100, (Number(amount) / Number(limit)) * 100)) : 0;
	const BUCKETS = {
		past: 'app.dashboard.bucket_past',
		d30: 'app.dashboard.bucket_d30',
		d60: 'app.dashboard.bucket_d60',
		d90: 'app.dashboard.bucket_d90'
	} as const;
</script>

{#snippet asOf()}
	<Inline
		as="label"
		for="treasury-analysis-date"
		gap="xs"
		align="center"
		class="rounded-md border border-border bg-card px-2.5 py-1.5 text-meta"
	>
		<span>{t('app.dashboard.as_of')}</span>
		<TimeInput
			{ctx}
			id="treasury-analysis-date"
			of="date"
			value={as_of}
			on_change={(value: string | null) => (picked = value)}
		/>
	</Inline>
{/snippet}

{#snippet usageBar(bank: { bank: string; limit: string; used: string; earmarked: string })}
	<Bound clip class="rounded">
		<Inline
			gap="none"
			align="stretch"
			role="img"
			aria-label={`${bank.bank}: ${t('app.dashboard.used')} ${usd(bank.used)}, ${t('app.dashboard.earmarked')} ${usd(bank.earmarked)}, ${t('app.dashboard.limit')} ${usd(bank.limit)}`}
			style="height:0.625rem;background:var(--chart-3)"
		>
			<span
				class="min-w-0"
				style={`flex-basis:${barPart(bank.used, bank.limit)}%;background:var(--chart-1)`}
			></span>
			<span
				class="min-w-0"
				style={`flex-basis:${barPart(bank.earmarked, bank.limit)}%;background:var(--chart-2)`}
			></span>
		</Inline>
	</Bound>
{/snippet}

<AppShell
	icon="lucide:layout-dashboard"
	title={t('app.dashboard.title')}
	description={t('app.dashboard.description')}
	variant="full"
	actions={asOf}
>
	<Scroll name="dashboard" size="fill" min_height="24rem" inset>
		{#if read.error}
			<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
		{:else if read.current === undefined}
			<Stack gap="lg" aria-busy="true">
				<Grid minimum="panel" gap="md">
					{#each [0, 1] as i (i)}
						<div class="rounded-md border border-border bg-card p-5">
							<Stack gap="sm">
								<div
									class="h-4 animate-pulse rounded bg-muted motion-reduce:animate-none"
									style="width:40%"
								></div>
								<div
									class="h-8 animate-pulse rounded bg-muted motion-reduce:animate-none"
									style="width:55%"
								></div>
								<div
									class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none"
									style="width:85%"
								></div>
							</Stack>
						</div>
					{/each}
				</Grid>
				<TableSkeleton />
			</Stack>
		{:else if incomplete}
			<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
		{:else if facilities.length === 0}
			<EmptyState title={t('app.dashboard.empty')} hint={t('app.dashboard.empty_hint')} />
		{:else}
			<Stack gap="md">
				{#if highBanks.length > 0 || lcsToOpen > 0}
					<div class="rounded-md border border-border bg-card px-4 py-3">
						<Cluster justify="between" align="center" gap="sm">
							<Cluster gap="sm" align="center">
								{#each highBanks as bank (bank.bank)}
									<Badge variant="warning">
										{bank.bank} · {bank.used_pct?.toFixed(0)}%
									</Badge>
								{/each}
								{#if lcsToOpen > 0}
									<Badge variant="info">{lcsToOpen} {t('app.alerts.lcs')}</Badge>
								{/if}
								<span class="text-meta">{t('app.dashboard.alerts_hint')}</span>
							</Cluster>
							<Inline
								as="a"
								href={ctx.href('treasury', 'alerts')}
								gap="xs"
								align="center"
								class="text-sm text-brand-text"
							>
								<span>{t('app.alerts.title')}</span>
								<Icon name="lucide:arrow-up-right" class="size-4" />
							</Inline>
						</Cluster>
					</div>
				{/if}

				<Grid minimum="panel" gap="md">
					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="md">
							<Inline justify="between" align="center">
								<h2 class="text-heading">{t('app.dashboard.total_facilities')}</h2>
								<Badge variant={usage.total.high ? 'destructive' : 'outline'}>
									{usage.total.used_pct?.toFixed(0) ?? '—'}% {t('app.dashboard.used')}
								</Badge>
							</Inline>
							<p class="text-metric">{usd(usage.total.limit)}</p>
							<Stack gap="xs">
								{@render usageBar(usage.total)}
								<Cluster gap="sm" align="center" class="text-meta">
									<Inline gap="xs" align="center">
										<span class="inline-block size-2 rounded-xs" style="background:var(--chart-1)"
										></span>
										<span>{t('app.dashboard.used')}</span>
									</Inline>
									<Inline gap="xs" align="center">
										<span class="inline-block size-2 rounded-xs" style="background:var(--chart-2)"
										></span>
										<span>{t('app.dashboard.earmarked')}</span>
									</Inline>
									<Inline gap="xs" align="center">
										<span class="inline-block size-2 rounded-xs" style="background:var(--chart-3)"
										></span>
										<span>{t('app.dashboard.free_after_earmarks')}</span>
									</Inline>
								</Cluster>
							</Stack>
							<Grid minimum="compact" gap="sm">
								{#each tiles as tile (tile.title)}
									<Stack gap="xs">
										<p class="text-meta">{tile.title}</p>
										<p class="text-heading tabular-nums">{tile.value}</p>
									</Stack>
								{/each}
							</Grid>
						</Stack>
					</section>

					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="md">
							<Inline justify="between" align="center">
								<h2 class="text-heading">{t('app.dashboard.usage_by_bank')}</h2>
								<Icon name="lucide:landmark" class="size-4 text-muted-foreground" />
							</Inline>
							<Stack gap="sm">
								{#each usage.banks as bank (bank.bank)}
									<Grid tracks="4rem minmax(0,1fr) 3rem" align="center" gap="sm">
										<span class="text-sm">{bank.bank}</span>
										{@render usageBar(bank)}
										<span
											class={['text-right text-meta tabular-nums', bank.high && 'text-destructive']}
										>
											{bank.used_pct?.toFixed(0) ?? '—'}%
										</span>
									</Grid>
								{/each}
							</Stack>
						</Stack>
					</section>
				</Grid>

				<Grid minimum="panel" gap="md">
					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="md">
							<Inline justify="between" align="center">
								<h2 class="text-heading">{t('app.dashboard.coming_due')}</h2>
								<Icon name="lucide:calendar-clock" class="size-4 text-muted-foreground" />
							</Inline>
							<Grid minimum="compact" gap="sm">
								{#each due as bucket (bucket.key)}
									<Stack gap="xs">
										<p class="text-meta">{t(BUCKETS[bucket.key])}</p>
										<p class="text-heading tabular-nums">{usd(bucket.amount)}</p>
										<p class="text-meta">{t('app.dashboard.lines', { count: bucket.count })}</p>
									</Stack>
								{/each}
							</Grid>
							<Cluster justify="between" align="center" gap="sm">
								<Inline gap="xs" align="center">
									<span class="text-meta">{t('app.dashboard.month_end')}:</span>
									<span class="text-sm">
										{latest === undefined ? '—' : monthLabel(latest.month.slice(0, 7))}
									</span>
									<Badge variant={latest?.is_locked ? 'success' : 'outline'}>
										{latest?.is_locked ? t('app.dashboard.closed') : t('app.dashboard.unlocked')}
									</Badge>
								</Inline>
								<Inline
									as="a"
									href={ctx.href('treasury', 'alerts')}
									gap="xs"
									align="center"
									class="text-meta"
								>
									<span>{t('app.alerts.title')}</span>
									<Icon name="lucide:arrow-up-right" class="size-3.5" />
								</Inline>
							</Cluster>
						</Stack>
					</section>

					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="md">
							<Inline justify="between" align="center">
								<h2 class="text-heading">{t('app.dashboard.cost_of_funds')}</h2>
								<Icon name="lucide:percent" class="size-4 text-muted-foreground" />
							</Inline>
							<p class="text-metric">{rate(costAll?.rate ?? null)}</p>
							<Grid minimum="compact" gap="sm">
								<Stack gap="xs">
									<Label for="treasury-period-preset">{t('app.dashboard.period')}</Label>
									<Combobox
										id="treasury-period-preset"
										options={picks.map((p) => ({ value: p.value, label: p.label }))}
										value={period}
										on_change={(v) => {
											period = v ?? 'month';
											selectedRange = null;
										}}
									/>
								</Stack>
								<Stack gap="xs">
									<Label for="treasury-cost-period">{t('app.dashboard.month_range')}</Label>
									<TimeRangeInput
										{ctx}
										id="treasury-cost-period"
										of="date"
										precision="month"
										value={selectedRange ?? { from: window.from, to: window.to }}
										on_change={(value) => (selectedRange = value)}
									/>
								</Stack>
							</Grid>
							<p class="text-meta">
								{t('app.dashboard.period_cost', {
									from: format({ kind: 'date' }, window.from, { locale: ctx.locale }),
									to: format({ kind: 'date' }, window.to, { locale: ctx.locale }),
									rate: rate(costAll?.rate ?? null),
									interest: usd(costAll?.interest),
									balance: usd(costAll?.average_balance)
								})}
							</p>
							<Cluster gap="md" align="center">
								<Inline gap="xs" align="baseline">
									<span class="text-meta">{t('app.dashboard.current_rate')}:</span>
									<span class="text-sm tabular-nums">{rate(weightedRate(open))}</span>
								</Inline>
								<Inline gap="xs" align="baseline">
									<span class="text-meta">{t('app.dashboard.simple_average')}:</span>
									<span class="text-sm tabular-nums">{rate(simpleRate(open))}</span>
								</Inline>
							</Cluster>
						</Stack>
					</section>
				</Grid>

				<Grid minimum="panel" gap="md">
					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="sm">
							<h2 class="text-heading">{t('app.dashboard.ladder')}</h2>
							<Bound height="18rem">
								<Chart {ctx} of={ladder} x="month" y="amount" kind="bar" />
							</Bound>
						</Stack>
					</section>

					<section class="rounded-md border border-border bg-card p-5">
						<Stack gap="sm">
							<h2 class="text-heading">{t('app.dashboard.trend')}</h2>
							<Bound height="18rem">
								<Chart {ctx} of={trend} x="month" y={['weighted', 'simple']} kind="line" />
							</Bound>
						</Stack>
					</section>
				</Grid>

				<section class="rounded-md border border-border bg-card p-5">
					<Stack gap="sm">
						<h2 class="text-heading">{t('app.dashboard.cost_by_bank')}</h2>
						<Table
							{ctx}
							of={cost.filter((bank) => bank.bank !== 'all')}
							controlled
							embedded
							columns={[
								{ field: 'bank', label: t('app.dashboard.bank') },
								{
									field: 'rate',
									label: t('app.dashboard.rate'),
									kind: { kind: 'decimal', scale: 2 },
									align: 'end'
								},
								{
									field: 'interest',
									label: t('app.dashboard.interest'),
									kind: { kind: 'money', currency: 'USD' },
									align: 'end'
								},
								{
									field: 'average_balance',
									label: t('app.dashboard.average_balance'),
									kind: { kind: 'money', currency: 'USD' },
									align: 'end'
								},
								{
									field: 'lines',
									label: t('app.dashboard.lines_column'),
									kind: { kind: 'int' },
									align: 'end'
								}
							]}
						/>
					</Stack>
				</section>
			</Stack>
		{/if}
	</Scroll>
</AppShell>
