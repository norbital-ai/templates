<script lang="ts">
	/**
	 * The month-end report for any month: every line owed at its close with accrued interest, interest to maturity and
	 * charges, and the headline figures. A locked month shows its frozen copy; any other follows live data.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		Icon,
		Table,
		TableSkeleton,
		TimeInput,
		format,
		open_record,
		use_act
	} from '@norbital-ai/ui';
	import { AppShell, Cluster, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { addMonths, monthEnd } from '../../lib/calculations.js';
	import type { Product } from '../../lib/products.js';
	import { FACILITY_FIELDS, MONTH_END_LINE_FIELDS, monthEndFrom } from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const act = use_act(ctx);
	let picked = $state<string | null>(null);
	// last month by default: the one to close
	const month = $derived(`${picked ?? addMonths(day.today, -1).slice(0, 7)}-01`);
	const stored = $derived(
		ctx.query({
			month_end: {
				where: { month: { eq: month } },
				fields: [
					'source',
					'is_locked',
					'locked_at',
					'credit_line',
					'bank_borrowings',
					'letters_of_credit',
					'term_bills',
					'banker_guarantee',
					'total_utilised',
					'available',
					'accrued_interest',
					'weighted_average_rate_pct',
					'simple_average_rate_pct',
					'highest_rate_pct',
					'lowest_rate_pct',
					'average_tenor_days'
				],
				limit: 1
			}
		})
	);
	const report = $derived(stored.current?.month_end.rows[0]);
	const locked = $derived(report?.is_locked === true);
	const live = $derived(
		stored.current === undefined || locked
			? null
			: ctx.query({
					drawdown: {
						where: { status: { in: ['applied', 'active', 'settled'] } },
						fields: [...MONTH_END_LINE_FIELDS],
						supplier: { fields: ['name'] },
						charges: { fields: ['amount', 'fx_rate_to_usd', 'stage'] }
					},
					facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
					fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] }
				})
	);
	const computed = $derived(
		live?.current === undefined
			? null
			: monthEndFrom(
					month,
					live.current.drawdown.rows,
					live.current.facility.rows,
					live.current.fx_rate.rows
				)
	);
	const figures = $derived(locked && report !== undefined ? report : computed?.figures);
	const usd = (value: string | null | undefined) =>
		value == null ? '—' : format({ kind: 'money' }, value, { locale: ctx.locale, currency: 'USD' });
	const pct = (value: string | null | undefined) =>
		value == null ? '—' : `${Number(value).toFixed(3)}%`;
	const actions = $derived(
		report?.source === 'excel'
			? []
			: [
					...(report === undefined
						? []
						: [
								{
									icon: 'lucide:history',
									name: t('app.month_end.details'),
									run: () => open_record('month_end', report.id)
								}
							]),
					...(!locked
						? (['xlsx', 'csv'] as const).map((to) => ({
								icon: 'lucide:download',
								name: `${t('app.month_end.export')} ${to.toUpperCase()}`,
								run: () =>
									ctx.sync_control('month_end_line', 'sheet', {
										mode: 'export',
										to,
										context: { month }
									})
							}))
						: [])
				]
	);
	const kpis = $derived(
		figures === undefined
			? []
			: [
					{
						title: t('app.month_end.utilised'),
						value: usd(figures.total_utilised),
						hint: t('app.month_end.utilised_hint', {
							limit: usd(figures.credit_line),
							available: usd(figures.available)
						})
					},
					{
						title: t('app.month_end.accrued'),
						value: usd(figures.accrued_interest),
						hint: t('app.month_end.accrued_hint', {
							borrowings: usd(figures.bank_borrowings),
							lc: usd(figures.letters_of_credit)
						})
					},
					{
						title: t('app.month_end.weighted'),
						value: pct(figures.weighted_average_rate_pct),
						hint: t('app.month_end.rate_hint', {
							low: pct(figures.lowest_rate_pct),
							high: pct(figures.highest_rate_pct),
							simple: pct(figures.simple_average_rate_pct)
						})
					},
					{
						title: t('app.month_end.tenor'),
						value:
							figures.average_tenor_days == null
								? '—'
								: t('app.line.days', { days: figures.average_tenor_days }),
						hint: t('app.month_end.tenor_hint')
					}
				]
	);
</script>

{#snippet moneyCell({
	row,
	value
}: {
	row: { readonly currency: string | null };
	value: string | null | undefined;
})}
	{value == null
		? '—'
		: format({ kind: 'money' }, value, {
				locale: ctx.locale,
				...(row.currency ? { currency: row.currency } : {})
			})}
{/snippet}

{#snippet productCell({ value }: { value: Product | null | undefined })}
	{#if value}
		<Badge variant="outline">{t(`models.month_end_line.fields.product.${value}`)}</Badge>
	{:else}
		—
	{/if}
{/snippet}

{#snippet pick()}
	<Inline
		as="label"
		for="treasury-report-month"
		gap="xs"
		align="center"
		class="rounded-md border border-border bg-card px-2.5 py-1.5 text-meta"
	>
		<span>{t('app.month_end.month')}</span>
		<TimeInput
			{ctx}
			id="treasury-report-month"
			of="month"
			value={month.slice(0, 7)}
			on_change={(value: string | null) => (picked = value)}
		/>
	</Inline>
{/snippet}

{#snippet summary()}
	<Stack gap="sm">
		<Cluster justify="between" align="center" gap="sm">
			<Cluster gap="sm" align="center">
				{#if stored.current !== undefined}
					<Badge variant={locked ? 'success' : 'info'}>
						{locked ? t('app.month_end.status_locked') : t('app.month_end.status_live')}
					</Badge>
				{/if}
				<p class="text-meta">
					{locked
						? t('app.month_end.locked_note', { end: monthEnd(month) })
						: t('app.month_end.live_note', { end: monthEnd(month) })}
				</p>
			</Cluster>
			{#if stored.current !== undefined && report?.source !== 'excel'}
				{#if locked && report !== undefined}
					<Button
						variant="outline"
						disabled={act.pending}
						onclick={() => act.run(ctx.run('month_end_unlock', { report: [report.id] }))}
					>
						<Icon name="lucide:lock-open" class="size-4" />
						{t('app.month_end.unlock')}
					</Button>
				{:else}
					<Button
						variant="brand"
						disabled={act.pending}
						onclick={() => act.run(ctx.run('month_end_lock', { month }))}
					>
						<Icon name="lucide:lock" class="size-4" />
						{t('app.month_end.lock')}
					</Button>
				{/if}
			{/if}
		</Cluster>
		{#if figures === undefined}
			<Grid minimum="compact" gap="sm" aria-busy="true">
				{#each [0, 1, 2, 3] as i (i)}
					<div class="rounded-md border border-border bg-card p-4">
						<Stack gap="xs">
							<div
								class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none"
								style="width:50%"
							></div>
							<div
								class="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none"
								style="width:70%"
							></div>
							<div
								class="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none"
								style="width:80%"
							></div>
						</Stack>
					</div>
				{/each}
			</Grid>
		{:else}
			<Grid minimum="compact" gap="sm">
				{#each kpis as kpi (kpi.title)}
					<div class="rounded-md border border-border bg-card p-4">
						<Stack gap="xs">
							<p class="text-meta">{kpi.title}</p>
							<p class="text-heading tabular-nums">{kpi.value}</p>
							<p class="text-meta">{kpi.hint}</p>
						</Stack>
					</div>
				{/each}
			</Grid>
		{/if}
	</Stack>
{/snippet}

<AppShell
	icon="lucide:calendar-check"
	title={t('app.month_end.title')}
	description={t('app.month_end.description')}
	actions={pick}
>
	{#if stored.error || live?.error}
		<EmptyState title={t('app.dashboard.error')} hint={String(stored.error ?? live?.error)} />
	{:else}
		<Cover size="fill" gap="md" top={summary}>
			{#if stored.current === undefined || (!locked && live?.current === undefined)}
				<div aria-busy="true"><TableSkeleton /></div>
			{:else if locked && report?.source === 'excel'}
				<EmptyState title={t('app.month_end.imported')} hint={t('app.month_end.imported_hint')} />
			{:else if locked && report !== undefined}
				<Table
					{ctx}
					of="month_end_line"
					key="frozen"
					where={{ month_end: { eq: report.id } }}
					order_by={{ bank_code: 'asc' }}
					columns={[
						'bank_code',
						'product',
						'reference',
						'supplier',
						{
							field: 'amount',
							kind: { kind: 'money', currency: 'currency' },
							align: 'end',
							cell: moneyCell
						},
						{ field: 'amount_usd', kind: { kind: 'money', currency: 'USD' }, align: 'end' },
						{
							field: 'interest_rate_pct',
							kind: { kind: 'decimal', scale: 2 },
							align: 'end'
						},
						'due_date',
						{ field: 'accrued_days', align: 'end' },
						{
							field: 'accrued_interest',
							kind: { kind: 'money', currency: 'currency' },
							align: 'end',
							cell: moneyCell
						},
						{
							field: 'interest_to_maturity',
							kind: { kind: 'money', currency: 'currency' },
							align: 'end',
							cell: moneyCell
						},
						{ field: 'charges', kind: { kind: 'money', currency: 'USD' }, align: 'end' }
					]}
					toolbar={{ title: t('app.month_end.lines'), actions, context: { month }, new: false }}
				/>
			{:else}
				<Table
					{ctx}
					of={computed?.lines ?? []}
					controlled
					columns={[
						{ field: 'bank_code', label: t('app.month_end.col_bank_code') },
						{ field: 'product', label: t('app.month_end.col_product'), cell: productCell },
						{ field: 'reference', label: t('app.month_end.col_reference') },
						{ field: 'supplier', label: t('app.month_end.col_supplier') },
						{
							field: 'amount',
							label: t('app.month_end.col_amount'),
							kind: { kind: 'money', currency: 'currency' },
							align: 'end'
						},
						{
							field: 'amount_usd',
							label: t('app.month_end.col_amount_usd'),
							kind: { kind: 'money', currency: 'USD' },
							align: 'end'
						},
						{
							field: 'interest_rate_pct',
							label: t('app.month_end.col_interest_rate_pct'),
							kind: { kind: 'decimal', scale: 2 },
							align: 'end'
						},
						{ field: 'due_date', label: t('app.month_end.col_due_date'), kind: { kind: 'date' } },
						{
							field: 'accrued_days',
							label: t('app.month_end.col_accrued_days'),
							kind: { kind: 'int' },
							align: 'end'
						},
						{
							field: 'accrued_interest',
							label: t('app.month_end.col_accrued_interest'),
							kind: { kind: 'money', currency: 'currency' },
							align: 'end'
						},
						{
							field: 'interest_to_maturity',
							label: t('app.month_end.col_interest_to_maturity'),
							kind: { kind: 'money', currency: 'currency' },
							align: 'end'
						},
						{
							field: 'charges',
							label: t('app.month_end.col_charges'),
							kind: { kind: 'money', currency: 'USD' },
							align: 'end'
						}
					]}
					toolbar={{ title: t('app.month_end.lines'), actions }}
					on_open={(row) => open_record('drawdown', row.drawdown)}
				/>
			{/if}
		</Cover>
	{/if}
</AppShell>
