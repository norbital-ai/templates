<script lang="ts">
	/**
	 * Fixings of deals to confirm and live deals, each worked out from the bank's rate: the past ones still needing a
	 * rate first, then the next 30 days, then everything. Open a row for its deal; record the rate on its fixing.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		EmptyState,
		Table,
		TableSkeleton,
		Tabs,
		open_record,
		type BadgeVariant
	} from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { addDays } from '../../lib/calculations.js';
	import { dealView, gainUsd, FX_DEAL_READ, type FxOutcome, type FxSide } from '../../lib/fx.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const read = ctx.query(FX_DEAL_READ);
	let show = $state<'todo' | 'next' | 'all'>('todo');
	const allRows = $derived.by(() => {
		const rates = read.current?.fx_rate.rows ?? [];
		const deals = (read.current?.fx_deal.rows ?? []).filter((d) => d.status !== 'proposal');
		return deals
			.flatMap((d) => {
				const v = dealView(d, rates, day.today);
				const currency = d.notional_currency ?? d.pair.slice(0, 3);
				return d.fixings.map((f) => {
					const r = v.result.get(f.id);
					return {
						deal: d.id,
						fixing_date: f.fixing_date,
						contract: `${d.bank?.code ?? ''} ${d.pair} ${t(`models.fx_deal.fields.structure.${d.structure}`)} · ${d.bank_reference ?? d.trade_date ?? ''}`,
						side: d.side,
						currency,
						amount: f.notional ?? d.notional,
						strike: f.strike ?? d.strike,
						fixing_rate: f.fixing_rate,
						outcome: r?.outcome ?? null,
						exchanged: r?.amount ?? null,
						gain_usd:
							r?.gain == null
								? null
								: gainUsd(d.pair, r.gain, f.settlement_date ?? f.fixing_date, rates),
						todo: f.fixing_date < day.today && (r?.outcome ?? null) === null
					};
				});
			})
			.sort((a, b) => a.fixing_date.localeCompare(b.fixing_date));
	});
	const todoRows = $derived(allRows.filter((r) => r.todo));
	const nextRows = $derived(
		allRows.filter((r) => r.fixing_date >= day.today && r.fixing_date <= addDays(day.today, 30))
	);
	const rows = $derived(show === 'todo' ? todoRows : show === 'next' ? nextRows : allRows);

	const outcomeVariant = (outcome: FxOutcome | null | undefined): BadgeVariant => {
		if (outcome === null || outcome === undefined) return 'info';
		if (outcome === 'exercised' || outcome === 'not_converted') return 'success';
		if (outcome === 'leveraged' || outcome === 'knocked_out' || outcome === 'converted')
			return 'warning';
		return 'outline';
	};
</script>

{#snippet sideCell({ value }: { value: FxSide | null | undefined })}
	{#if value === 'buy' || value === 'sell'}
		<Badge variant="outline">{t(`models.fx_deal.fields.side.${value}`)}</Badge>
	{:else}
		—
	{/if}
{/snippet}

{#snippet outcomeCell({ value }: { value: FxOutcome | null | undefined })}
	<Badge variant={outcomeVariant(value)}>
		{value == null ? t('fx.outcome.open') : t(`fx.outcome.${value}`)}
	</Badge>
{/snippet}

{#snippet fixingTable()}
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
	{:else if read.current === undefined}
		<div aria-busy="true"><TableSkeleton /></div>
	{:else}
		<Table
			{ctx}
			of={rows}
			toolbar={{ title: false, new: false }}
			columns={[
				{ field: 'fixing_date', label: t('fx.fixing'), kind: { kind: 'date' } },
				{ field: 'contract', label: t('fx.contract') },
				{ field: 'side', label: t('fx.side'), cell: sideCell },
				{
					field: 'amount',
					label: t('fx.amount'),
					kind: { kind: 'money', currency: 'currency' },
					align: 'end'
				},
				{
					field: 'strike',
					label: t('fx.strike'),
					kind: { kind: 'decimal', scale: 4 },
					align: 'end'
				},
				{
					field: 'fixing_rate',
					label: t('fx.fixed_at'),
					kind: { kind: 'decimal', scale: 4 },
					align: 'end'
				},
				{ field: 'outcome', label: t('fx.result'), cell: outcomeCell },
				{
					field: 'exchanged',
					label: t('fx.exchanged'),
					kind: { kind: 'money', currency: 'currency' },
					align: 'end'
				},
				{
					field: 'gain_usd',
					label: t('fx.gain_usd'),
					kind: { kind: 'money', currency: 'USD' },
					align: 'end'
				}
			]}
			on_open={(row) => open_record('fx_deal', row.deal)}
		/>
	{/if}
{/snippet}

<AppShell
	icon="lucide:calendar-clock"
	title={t('fx.fixings.title')}
	description={t('fx.fixings.description')}
	variant="full"
>
	<Tabs
		value={show}
		on_value_change={(v) => (show = v === 'next' || v === 'all' ? v : 'todo')}
		tabs={[
			{
				name: 'todo',
				title: t('fx.fixings.todo'),
				...(read.current === undefined ? {} : { count: todoRows.length }),
				body: fixingTable
			},
			{
				name: 'next',
				title: t('fx.fixings.next'),
				...(read.current === undefined ? {} : { count: nextRows.length }),
				body: fixingTable
			},
			{
				name: 'all',
				title: t('fx.fixings.all'),
				...(read.current === undefined ? {} : { count: allRows.length }),
				body: fixingTable
			}
		]}
	/>
</AppShell>
