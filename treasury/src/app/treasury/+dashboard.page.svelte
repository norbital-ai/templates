<script lang="ts">
	/**
	 * Where the group stands: limit, used, available and earmarked across the banks, usage per bank, what falls due,
	 * the cost of funds now, over a chosen period and month by month, the FX exposure, the month-end and the alerts.
	 * Every figure is USD and comes from one read of the facilities and lines plus the shared treasury helpers.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Chart,
		Icon,
		Combobox,
		EmptyState,
		TimeInput,
		TimeRangeInput,
		Table,
		format,
		value_object,
		type Value
	} from '@norbital-ai/ui';
	import { AppShell, Bound, Scroll } from '@norbital-ai/ui/layout';
	import { addDays, addMonths, monthEnd, monthStart } from '../../lib/calculations.js';
	import {
		FACILITY_FIELDS,
		LINE_FIELDS,
		costOfFundsTrend,
		maturities,
		maturityLadder,
		periodCost,
		utilisation,
		simpleRate,
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
					: monthLabel(r.month)
		}))
	);
	const trend = $derived(costOfFundsTrend(lines, as_of));
	const latest = $derived(read.current?.month_end.rows[0]);

	// the cost-of-funds period: quick picks counted from the as-of day; the financial year starts 1 April
	const fy = $derived(
		`${Number(as_of.slice(0, 4)) - (Number(as_of.slice(5, 7)) < 4 ? 1 : 0)}-04-01`
	);
	const picks = $derived([
		{ value: 'month', label: t('app.dashboard.this_month'), from: monthStart(as_of), to: as_of },
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
	const window = $derived(customRange ?? picks.find((p) => p.value === period) ?? picks[0]!);
	const cost = $derived(periodCost(lines, banks, window.from, window.to));
	const costAll = $derived(cost.find((c) => c.bank === 'all'));

	const usd = (value: string | null | undefined) =>
		value == null ? '—' : format({ kind: 'decimal', scale: 2 }, value, { locale: ctx.locale });
	const rate = (value: string | null) => (value === null ? '—' : `${Number(value).toFixed(2)}%`);
	const tiles = $derived([
		[t('app.dashboard.used'), usd(usage.total.used)],
		[t('app.dashboard.available'), usd(usage.total.available)],
		[t('app.dashboard.earmarked'), usd(usage.total.earmarked)],
		[t('app.dashboard.free_after_earmarks'), usd(usage.total.free_after_earmarks)]
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
	<label
		for="treasury-analysis-date"
		class="flex items-center gap-2 rounded-md bg-card p-2 text-meta"
	>
		{t('app.dashboard.as_of')}
		<div class="w-44">
			<TimeInput
				{ctx}
				id="treasury-analysis-date"
				of="date"
				value={as_of}
				on_change={(value: string | null) => (picked = value)}
			/>
		</div>
	</label>
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
			<EmptyState title={t('app.dashboard.loading')} />
		{:else if incomplete}
			<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
		{:else if facilities.length === 0}
			<EmptyState title={t('app.dashboard.empty')} hint={t('app.dashboard.empty_hint')} />
		{:else}
			<div class="dashboard-grid">
				<section class="panel summary">
					<div class="panel-heading">
						<h2>{t('app.dashboard.total_facilities')}</h2>
						<span class:usage-warning={usage.total.high} class="text-meta"
							>{usage.total.used_pct?.toFixed(0) ?? '—'}% {t('app.dashboard.used')}</span
						>
					</div>
					<p class="hero tabular-nums">{usd(usage.total.limit)}</p>
					{@render usageBar(usage.total)}
					<div class="usage-legend text-meta">
						<span><i class="used"></i>{t('app.dashboard.used')}</span><span
							><i class="earmark"></i>{t('app.dashboard.earmarked')}</span
						><span><i class="free"></i>{t('app.dashboard.free_after_earmarks')}</span>
					</div>
					<div class="metric-grid">
						{#each tiles as [title, value] (title)}<div>
								<p class="text-meta">{title}</p>
								<p class="metric tabular-nums">{value}</p>
							</div>{/each}
					</div>
				</section>
				<section class="panel banks">
					<div class="panel-heading">
						<h2>{t('app.dashboard.usage_by_bank')}</h2>
						<Icon name="lucide:landmark" class="size-4 text-muted-foreground" />
					</div>
					<div class="bank-rows">
						{#each usage.banks as bank (bank.bank)}
							<div class="bank-row">
								<span class="font-medium">{bank.bank}</span>{@render usageBar(bank)}<span
									class="text-meta tabular-nums"
									class:usage-warning={bank.high}>{bank.used_pct?.toFixed(0) ?? '—'}%</span
								>
							</div>
						{/each}
					</div>
				</section>
				<section class="panel funding">
					<div class="panel-heading">
						<h2>{t('app.dashboard.cost_of_funds')}</h2>
						<Icon name="lucide:percent" class="size-4 text-muted-foreground" />
					</div>
					<p class="hero tabular-nums">{rate(costAll?.rate ?? null)}</p>
					<div class="grid gap-3">
						<Combobox
							aria-label={t('app.dashboard.period')}
							options={picks.map((p) => ({ value: p.value, label: p.label }))}
							value={period}
							on_change={(v) => {
								period = v ?? 'month';
								selectedRange = null;
							}}
						/>
						<label for="treasury-cost-period" class="grid gap-2 text-meta"
							>{t('app.dashboard.month_range')}<TimeRangeInput
								{ctx}
								id="treasury-cost-period"
								of="date"
								precision="month"
								value={selectedRange ?? { from: window.from, to: window.to }}
								on_change={(value) => (selectedRange = value)}
							/></label
						>
						<p class="text-meta">
							{t('app.dashboard.period_cost', {
								from: format({ kind: 'date' }, window.from, { locale: ctx.locale }),
								to: format({ kind: 'date' }, window.to, { locale: ctx.locale }),
								rate: rate(costAll?.rate ?? null),
								interest: usd(costAll?.interest),
								balance: usd(costAll?.average_balance)
							})}
						</p>
						<p class="text-meta">
							{t('app.dashboard.current_rate')}:
							<b class="text-foreground">{rate(weightedRate(open))}</b>
						</p>
						<p class="text-meta">
							{t('app.dashboard.simple_average')}:
							<b class="text-foreground">{rate(simpleRate(open))}</b>
						</p>
					</div>
				</section>
				<section class="panel ladder">
					<h2>{t('app.dashboard.ladder')}</h2>
					<Bound class="mt-4 h-72"
						><Chart {ctx} of={ladder} x="month" y="amount" kind="bar" /></Bound
					>
				</section>
				<section class="panel due">
					<div class="panel-heading">
						<h2>{t('app.dashboard.coming_due')}</h2>
						<Icon name="lucide:calendar-clock" class="size-4 text-muted-foreground" />
					</div>
					<div class="metric-grid">
						{#each due as bucket (bucket.key)}<div>
								<p class="text-meta">{t(BUCKETS[bucket.key])}</p>
								<p class="metric tabular-nums">{usd(bucket.amount)}</p>
								<p class="text-meta">{t('app.dashboard.lines', { count: bucket.count })}</p>
							</div>{/each}
					</div>
					<p class="mt-5 text-meta">
						{t('app.dashboard.month_end')}:
						<b class="text-foreground"
							>{latest === undefined ? '—' : monthLabel(latest.month.slice(0, 7))}</b
						>
						· {latest?.is_locked ? t('app.dashboard.closed') : t('app.dashboard.unlocked')}
					</p>
				</section>
				<section class="panel trend">
					<h2>{t('app.dashboard.trend')}</h2>
					<Bound class="mt-4 h-72"
						><Chart
							{ctx}
							of={trend.map((point) => ({ ...point, month: monthLabel(point.month) }))}
							x="month"
							y={['weighted', 'simple']}
							kind="line"
						/></Bound
					>
				</section>
				<section class="panel attention">
					<div class="panel-heading">
						<h2>{t('app.alerts.title')}</h2>
						<a href="/app/treasury/alerts" aria-label={t('app.alerts.title')}
							><Icon name="lucide:arrow-up-right" class="size-5" /></a
						>
					</div>
					<div class="grid gap-4">
						{#each highBanks as bank (bank.bank)}<p class="text-meta">
								<b class="text-foreground">{bank.bank} · {bank.used_pct?.toFixed(0)}%</b><br />{t(
									'app.dashboard.available'
								)}: {usd(bank.available)} USD
							</p>{/each}
						<p class="text-meta">
							<b class="text-foreground">{lcsToOpen}</b>
							{t('app.alerts.lcs')}
						</p>
						<p class="text-meta">{t('app.dashboard.alerts_hint')}</p>
					</div>
				</section>
				<section class="panel cost-table">
					<h2 class="mb-4">{t('app.dashboard.cost_by_bank')}</h2>
					<Table
						{ctx}
						of={cost.filter((bank) => bank.bank !== 'all')}
						controlled
						embedded
						columns={[
							{ field: 'bank', label: t('app.dashboard.bank') },
							{ field: 'rate', label: t('app.dashboard.rate'), align: 'end' },
							{
								field: 'interest',
								label: t('app.dashboard.interest'),
								kind: { kind: 'decimal', scale: 2 }
							},
							{
								field: 'average_balance',
								label: t('app.dashboard.average_balance'),
								kind: { kind: 'decimal', scale: 2 }
							},
							{ field: 'lines', label: t('app.dashboard.lines_column') }
						]}
					/>
				</section>
			</div>
		{/if}
	</Scroll>
</AppShell>

{#snippet usageBar(bank: { bank: string; limit: string; used: string; earmarked: string })}
	<div
		class="usage-bar"
		role="img"
		aria-label={`${bank.bank}: ${t('app.dashboard.used')} ${usd(bank.used)}, ${t('app.dashboard.earmarked')} ${usd(bank.earmarked)}, ${t('app.dashboard.limit')} ${usd(bank.limit)} USD`}
	>
		<span class="used" style:flex-basis={`${barPart(bank.used, bank.limit)}%`}></span><span
			class="earmark"
			style:flex-basis={`${barPart(bank.earmarked, bank.limit)}%`}
		></span><span class="free"></span>
	</div>
{/snippet}

<style>
	.dashboard-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	.panel {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--card);
		color: var(--card-foreground);
	}
	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	h2 {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.hero {
		font-size: clamp(1.5rem, 2.4vw, 2.25rem);
		font-weight: 650;
		margin-block: 0.75rem 1rem;
		overflow-wrap: anywhere;
	}
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem 1rem;
		margin-top: 1.25rem;
	}
	.metric {
		font-size: 1.125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.usage-bar {
		display: flex;
		height: 0.625rem;
		overflow: hidden;
		background: var(--chart-3);
		border-radius: 0.25rem;
	}
	.usage-bar span {
		min-width: 0;
		flex-shrink: 1;
	}
	.used {
		background: var(--chart-1);
	}
	.earmark {
		background: var(--chart-2);
	}
	.free {
		background: var(--chart-3);
		flex: 1;
	}
	.usage-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.usage-legend span {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.usage-legend i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 0.125rem;
	}
	.bank-rows {
		display: grid;
		gap: 1rem;
	}
	.bank-row {
		display: grid;
		grid-template-columns: 4rem minmax(0, 1fr) 3rem;
		gap: 0.75rem;
		align-items: center;
		font-size: 0.8125rem;
	}
	.usage-warning {
		color: var(--destructive);
	}
	@container (min-width: 70rem) {
		.dashboard-grid {
			grid-template-columns: repeat(12, minmax(0, 1fr));
		}
		.summary {
			grid-column: span 4;
		}
		.banks {
			grid-column: span 5;
		}
		.funding {
			grid-column: span 3;
		}
		.ladder {
			grid-column: span 7;
		}
		.due {
			grid-column: span 5;
		}
		.trend {
			grid-column: span 8;
		}
		.attention {
			grid-column: span 4;
		}
		.cost-table {
			grid-column: 1 / -1;
		}
	}
</style>
