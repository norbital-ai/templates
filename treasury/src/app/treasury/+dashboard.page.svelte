<script lang="ts">
	/**
	 * Where the group stands: limit, used, available and earmarked across the banks, usage per bank, what falls due,
	 * the cost of funds now, over a chosen period and month by month, the FX exposure, the month-end and the alerts.
	 * Every figure is USD and comes from one read of the facilities and lines plus the shared treasury helpers.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Chart, Combobox, EmptyState, Input, Table, format } from '@norbital-ai/ui';
	import { AppShell, Bound, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { addDays, addMonths, monthEnd, monthStart } from '../../lib/calculations.js';
	import {
		FACILITY_FIELDS,
		LINE_FIELDS,
		costOfFundsTrend,
		maturities,
		maturityLadder,
		periodCost,
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
	const window = $derived(picks.find((p) => p.value === period) ?? picks[0]!);
	const cost = $derived(periodCost(lines, banks, window.from, window.to));
	const costAll = $derived(cost.find((c) => c.bank === 'all'));

	const usd = (value: string | null | undefined) =>
		value == null ? '—' : format({ kind: 'decimal', scale: 2 }, value, { locale: ctx.locale });
	const rate = (value: string | null) => (value === null ? '—' : `${Number(value).toFixed(2)}%`);
	const tiles = $derived([
		[t('app.dashboard.limit'), usd(usage.total.limit)],
		[t('app.dashboard.used'), usd(usage.total.used)],
		[t('app.dashboard.available'), usd(usage.total.available)],
		[t('app.dashboard.earmarked'), usd(usage.total.earmarked)],
		[t('app.dashboard.free_after_earmarks'), usd(usage.total.free_after_earmarks)],
		[t('app.dashboard.cost_of_funds'), rate(weightedRate(open))]
	]);
	const BUCKETS = {
		past: 'app.dashboard.bucket_past',
		d30: 'app.dashboard.bucket_d30',
		d60: 'app.dashboard.bucket_d60',
		d90: 'app.dashboard.bucket_d90'
	} as const;
</script>

{#snippet asOf()}
	<Input
		type="date"
		class="w-40"
		aria-label={t('app.dashboard.as_of')}
		value={as_of}
		onchange={(e) => (picked = e.currentTarget.value || null)}
	/>
{/snippet}

<AppShell
	icon="lucide:layout-dashboard"
	title={t('app.dashboard.title')}
	description={t('app.dashboard.description')}
	variant="full"
	actions={asOf}
>
	<Scroll name="dashboard" size="fill" min_height="24rem">
		{#if read.error}
			<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
		{:else if read.current === undefined}
			<EmptyState title={t('app.dashboard.loading')} />
		{:else if incomplete}
			<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
		{:else if facilities.length === 0}
			<EmptyState title={t('app.dashboard.empty')} hint={t('app.dashboard.empty_hint')} />
		{:else}
			<Stack gap="lg">
				<Grid tracks="repeat(auto-fit, minmax(min(100%, 9rem), 1fr))">
					{#each tiles as [title, value] (title)}
						<div class="min-w-0">
							<p class="text-meta">{title}</p>
							<p class="mt-1 text-lg font-semibold tabular-nums">{value}</p>
						</div>
					{/each}
				</Grid>
				<Grid tracks="repeat(auto-fit, minmax(min(100%, 9rem), 1fr))">
					{#each due as bucket (bucket.key)}
						<div class="min-w-0">
							<p class="text-meta">{t(BUCKETS[bucket.key])}</p>
							<p class="mt-1 text-lg font-semibold tabular-nums">{usd(bucket.amount)}</p>
							<p class="text-meta">{t('app.dashboard.lines', { count: bucket.count })}</p>
						</div>
					{/each}
					<div class="min-w-0">
						<p class="text-meta">{t('app.dashboard.month_end')}</p>
						<p class="mt-1 text-lg font-semibold">
							{latest === undefined ? '—' : monthLabel(latest.month.slice(0, 7))}
						</p>
						<p class="text-meta">
							{latest === undefined
								? t('app.dashboard.no_month_end')
								: latest.source === 'portal' && latest.is_locked
									? t('app.dashboard.closed')
									: t('app.dashboard.unlocked')}
						</p>
					</div>
					<div class="min-w-0">
						<p class="text-meta">{t('app.dashboard.alerts')}</p>
						<p class="mt-1 text-lg font-semibold tabular-nums">
							{usage.banks.filter((b) => b.high).length} · {read.current.purchase_order.rows.filter(
								(po) =>
									!po.financings.some(
										(f) => f.drawdown?.product === 'lc' || f.drawdown?.lc_number != null
									)
							).length}
						</p>
						<p class="text-meta">{t('app.dashboard.alerts_hint')}</p>
					</div>
				</Grid>
				<Grid
					tracks="repeat(auto-fit, minmax(min(100%, max(18rem, calc((100% - 2rem) / 3))), 1fr))"
				>
					<Bound class="h-72">
						<Chart
							{ctx}
							of={usage.banks.map((b) => ({
								bank: b.bank,
								used: Number(b.used),
								available: Math.max(0, Number(b.available))
							}))}
							x="bank"
							y={['used', 'available']}
							kind="bar"
							stack
							title={t('app.dashboard.usage_by_bank')}
						/>
					</Bound>
					<Bound class="h-72">
						<Chart
							{ctx}
							of={ladder}
							x="month"
							y="amount"
							kind="bar"
							title={t('app.dashboard.ladder')}
						/>
					</Bound>
					<Bound class="h-72">
						<Chart
							{ctx}
							of={trend.map((p) => ({
								...p,
								month: monthLabel(p.month)
							}))}
							x="month"
							y="weighted"
							kind="line"
							title={t('app.dashboard.trend')}
						/>
					</Bound>
				</Grid>
				<Stack gap="sm">
					<Combobox
						class="w-56"
						aria-label={t('app.dashboard.period')}
						options={picks.map((p) => ({ value: p.value, label: p.label }))}
						value={period}
						on_change={(v) => (period = v ?? 'month')}
					/>
					<p class="text-meta">
						{t('app.dashboard.period_cost', {
							rate: rate(costAll?.rate ?? null),
							interest: usd(costAll?.interest),
							balance: usd(costAll?.average_balance)
						})}
					</p>
					<Table
						{ctx}
						of={cost.filter((c) => c.bank !== 'all')}
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
				</Stack>
			</Stack>
		{/if}
	</Scroll>
</AppShell>
