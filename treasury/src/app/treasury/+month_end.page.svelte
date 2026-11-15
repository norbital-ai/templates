<script lang="ts">
	/**
	 * The month-end report for any month: every line owed at its close with accrued interest, interest to maturity and
	 * charges, the totals by bank, and the headline figures. A locked month shows its frozen copy; any other follows
	 * live data. The ⚡ menu locks or unlocks the month and exports it. FX rates (month-end rates included) and the
	 * history of closed months sit beside it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Input, Table, Tabs, format } from '@norbital-ai/ui';
	import { AppShell, Grid, Stack } from '@norbital-ai/ui/layout';
	import { addMonths, monthEnd } from '../../lib/calculations.js';
	import { FACILITY_FIELDS, MONTH_END_LINE_FIELDS, monthEndFrom } from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	let picked = $state<string | null>(null);
	// last month by default: the one to close
	const month = $derived(`${picked ?? addMonths(day.today, -1).slice(0, 7)}-01`);
	const stored = $derived(
		ctx.query({
			month_end: {
				where: { month: { eq: month } },
				fields: [
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
	const live = ctx.query({
		drawdown: {
			where: { status: { in: ['applied', 'active', 'settled'] } },
			fields: [...MONTH_END_LINE_FIELDS],
			supplier: { fields: ['name'] },
			charges: { fields: ['amount', 'currency'] }
		},
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] }
	});
	const computed = $derived(
		live.current === undefined
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
	const actions = $derived([
		locked && report !== undefined
			? {
					icon: 'lucide:lock-open',
					name: t('app.month_end.unlock'),
					run: () => ctx.run('month_end_unlock', { report: [report.id] })
				}
			: {
					icon: 'lucide:lock',
					name: t('app.month_end.lock'),
					run: () => ctx.run('month_end_lock', { month })
				}
	]);
	const LINE_COLUMNS = [
		'bank_code',
		'product',
		'reference',
		'supplier',
		'currency',
		'amount',
		'amount_usd',
		'interest_rate_pct',
		'due_date',
		'accrued_days',
		'accrued_interest',
		'interest_to_maturity',
		'charges'
	] as const;
</script>

{#snippet pick()}
	<Input
		type="month"
		class="w-40"
		aria-label={t('app.month_end.month')}
		value={month.slice(0, 7)}
		onchange={(e) => (picked = e.currentTarget.value || null)}
	/>
{/snippet}

{#snippet lines()}
	<Stack gap="md">
		<p class="text-meta">
			{locked
				? t('app.month_end.locked_note', { end: monthEnd(month) })
				: t('app.month_end.live_note', { end: monthEnd(month) })}
		</p>
		{#if figures === undefined}
			<EmptyState title={t('app.dashboard.loading')} />
		{:else}
			<Grid minimum="compact">
				{#each [[t('app.month_end.credit_line'), usd(figures.credit_line)], [t('app.month_end.borrowings'), usd(figures.bank_borrowings)], [t('app.month_end.lc'), usd(figures.letters_of_credit)], [t('app.month_end.tb'), usd(figures.term_bills)], [t('app.month_end.guarantees'), usd(figures.banker_guarantee)], [t('app.month_end.utilised'), usd(figures.total_utilised)], [t('app.month_end.available'), usd(figures.available)], [t('app.month_end.accrued'), usd(figures.accrued_interest)], [t('app.month_end.weighted'), pct(figures.weighted_average_rate_pct)], [t('app.month_end.simple'), pct(figures.simple_average_rate_pct)], [t('app.month_end.range'), `${pct(figures.lowest_rate_pct)} – ${pct(figures.highest_rate_pct)}`], [t('app.month_end.tenor'), figures.average_tenor_days ?? '—']] as const as [title, value] (title)}
					<div class="rounded-xl border border-border bg-card p-4">
						<p class="text-meta">{title}</p>
						<p class="mt-1 text-lg font-semibold tabular-nums">{value}</p>
					</div>
				{/each}
			</Grid>
		{/if}
		{#if locked && report !== undefined}
			<Table
				{ctx}
				of="month_end_line"
				key="frozen"
				where={{ month_end: { eq: report.id } }}
				order_by={{ bank_code: 'asc' }}
				columns={LINE_COLUMNS}
				toolbar={{ title: t('app.month_end.lines'), actions, context: { month }, new: false }}
			/>
		{:else}
			<Table
				{ctx}
				of={computed?.lines ?? []}
				controlled
				columns={LINE_COLUMNS.map((field) => ({ field, label: t(`app.month_end.col_${field}`) }))}
				toolbar={{ title: t('app.month_end.lines'), actions }}
			/>
		{/if}
	</Stack>
{/snippet}
{#snippet history()}
	<Table
		{ctx}
		of="month_end"
		key="history"
		order_by={{ month: 'desc' }}
		columns={[
			'month',
			'is_locked',
			'locked_at',
			'total_utilised',
			'accrued_interest',
			'weighted_average_rate_pct'
		]}
		toolbar={{ title: t('app.month_end.history'), new: false }}
	/>
{/snippet}
{#snippet rates()}
	<Table
		{ctx}
		of="fx_rate"
		key="fx"
		order_by={{ rate_date: 'desc' }}
		columns={['currency', 'rate_date', 'usd_per_unit', 'is_month_end', 'source']}
		toolbar={{ title: t('app.month_end.fx') }}
	/>
{/snippet}

<AppShell
	icon="lucide:calendar-check"
	title={t('app.month_end.title')}
	description={t('app.month_end.description')}
	variant="full"
	actions={pick}
>
	<Tabs
		tabs={[
			{ name: 'report', title: t('app.month_end.lines'), icon: 'lucide:table', body: lines },
			{ name: 'history', title: t('app.month_end.history'), icon: 'lucide:history', body: history },
			{ name: 'fx', title: t('app.month_end.fx'), icon: 'lucide:arrow-left-right', body: rates }
		]}
	/>
</AppShell>
