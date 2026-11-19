<script lang="ts">
	/**
	 * Fixings of deals to confirm and live deals, each worked out from the bank's rate: the past ones still needing a
	 * rate first, then the next 30 days, then everything. Open a row for its deal; record the rate on its fixing.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, EmptyState, Table, open_record } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { addDays } from '../../lib/calculations.js';
	import { dealView, gainUsd, FX_DEAL_READ } from '../../lib/fx.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const read = ctx.query(FX_DEAL_READ);
	let show = $state<'todo' | 'next' | 'all'>('todo');
	const rows = $derived.by(() => {
		const rates = read.current?.fx_rate.rows ?? [];
		const deals = (read.current?.fx_deal.rows ?? []).filter((d) => d.status !== 'proposal');
		return deals
			.flatMap((d) => {
				const v = dealView(d, rates, day.today);
				return d.fixings.map((f) => {
					const r = v.result.get(f.id);
					return {
						deal: d.id,
						fixing_date: f.fixing_date,
						contract: `${d.bank?.code ?? ''} ${d.pair} ${t(`models.fx_deal.fields.structure.${d.structure}`)} · ${d.bank_reference ?? d.trade_date ?? ''}`,
						side: d.side ?? '—',
						amount: f.notional ?? d.notional,
						strike: f.strike ?? d.strike,
						fixing_rate: f.fixing_rate,
						outcome: r?.outcome == null ? t('fx.outcome.open') : t(`fx.outcome.${r.outcome}`),
						exchanged: r?.amount ?? null,
						gain_usd:
							r?.gain == null
								? null
								: gainUsd(d.pair, r.gain, f.settlement_date ?? f.fixing_date, rates),
						todo: f.fixing_date < day.today && (r?.outcome ?? null) === null
					};
				});
			})
			.filter(
				(r) =>
					show === 'all' ||
					(show === 'todo'
						? r.todo
						: r.fixing_date >= day.today && r.fixing_date <= addDays(day.today, 30))
			)
			.sort((a, b) => a.fixing_date.localeCompare(b.fixing_date));
	});
</script>

{#snippet pick()}
	<Combobox
		aria-label={t('fx.fixings.show')}
		options={[
			{ value: 'todo', label: t('fx.fixings.todo') },
			{ value: 'next', label: t('fx.fixings.next') },
			{ value: 'all', label: t('fx.fixings.all') }
		]}
		value={show}
		on_change={(v) => (show = v === 'next' || v === 'all' ? v : 'todo')}
	/>
{/snippet}

<AppShell
	icon="lucide:calendar-clock"
	title={t('fx.fixings.title')}
	description={t('fx.fixings.description')}
	actions={pick}
>
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
	{:else if read.current === undefined}
		<EmptyState title={t('app.dashboard.loading')} />
	{:else}
		<Table
			{ctx}
			of={rows}
			toolbar={{ title: false, new: false }}
			columns={[
				{ field: 'fixing_date', label: t('fx.fixing'), kind: { kind: 'date' } },
				{ field: 'contract', label: t('fx.contract') },
				{ field: 'side', label: t('fx.side') },
				{ field: 'amount', label: t('fx.amount'), kind: { kind: 'decimal', scale: 2 } },
				{ field: 'strike', label: t('fx.strike'), kind: { kind: 'decimal', scale: 4 } },
				{ field: 'fixing_rate', label: t('fx.fixed_at'), kind: { kind: 'decimal', scale: 4 } },
				{ field: 'outcome', label: t('fx.result') },
				{ field: 'exchanged', label: t('fx.exchanged'), kind: { kind: 'decimal', scale: 2 } },
				{ field: 'gain_usd', label: t('fx.gain_usd'), kind: { kind: 'decimal', scale: 0 } }
			]}
			on_open={(row) => open_record('fx_deal', row.deal)}
		/>
	{/if}
</AppShell>
