<script lang="ts">
	/**
	 * What the banks charge: actual charges on lines started in the last twelve months, per bank, as a share of the
	 * amount financed and per annum over the average tenor; the fee rules that estimate charges until an advice
	 * arrives; and every recorded charge.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { FACILITY_FIELDS, LINE_FIELDS, chargesSummary } from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const read = ctx.query({
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		drawdown: {
			where: { status: { in: ['applied', 'active', 'settled'] } },
			fields: [...LINE_FIELDS],
			charges: { fields: ['amount', 'currency'] }
		},
		fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] }
	});
	const banks = $derived(
		new Map((read.current?.facility.rows ?? []).map((f) => [f.id, f.bank?.code ?? '—']))
	);
	const rows = $derived(
		chargesSummary(
			read.current?.drawdown.rows ?? [],
			banks,
			read.current?.fx_rate.rows ?? [],
			day.today
		)
	);
</script>

{#snippet byBank()}
	<Table
		{ctx}
		of={rows}
		controlled
		columns={[
			{ field: 'bank', label: t('app.line.bank') },
			{ field: 'lines', label: t('app.dashboard.lines_column') },
			{ field: 'financed', label: t('app.charges.financed'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'charges', label: t('app.costs.charges'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'pct_of_amount', label: t('app.charges.pct_of_amount'), align: 'end' },
			{ field: 'pct_per_annum', label: t('app.charges.pct_per_annum'), align: 'end' },
			{ field: 'average_tenor_days', label: t('app.charges.tenor'), align: 'end' }
		]}
		toolbar={{ title: t('app.charges.by_bank') }}
	/>
{/snippet}
{#snippet rules()}
	<Table
		{ctx}
		of="facility_fee"
		key="rules"
		columns={[
			'facility',
			'fee_type',
			'product',
			'stage',
			'method',
			'currency',
			'rate_pct',
			'amount',
			'minimum_amount',
			'include_in_estimates'
		]}
		toolbar={{ title: t('app.charges.rules'), new: false }}
	/>
{/snippet}
{#snippet recorded()}
	<Table
		{ctx}
		of="drawdown_charge"
		key="recorded"
		columns={['drawdown', 'stage', 'charge_type', 'currency', 'amount', 'description']}
		toolbar={{ title: t('app.charges.recorded'), new: false }}
	/>
{/snippet}

<AppShell
	icon="lucide:receipt"
	title={t('app.charges.title')}
	description={t('app.charges.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'by_bank', title: t('app.charges.by_bank'), icon: 'lucide:building-2', body: byBank },
			{ name: 'rules', title: t('app.charges.rules'), icon: 'lucide:list-checks', body: rules },
			{ name: 'recorded', title: t('app.charges.recorded'), icon: 'lucide:receipt', body: recorded }
		]}
	/>
</AppShell>
