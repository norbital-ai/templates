<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Tabs, TimeInput, TimeRangeInput } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { DateTime, Schema } from 'effect';
	import type { SalesBasis } from '../../../lib/reports.js';
	import SalesAnalysis from './sales-analysis.svelte';
	import ReceivablesAging from './receivables-aging.svelte';
	import CommissionBoard from './commission-board.svelte';
	import CreditExceptions from './credit-exceptions.svelte';
	let { ctx }: { ctx: PageContext } = $props();
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	// the page scope each report reads: a sales period, an aging cutoff (last month's end), a commission month
	const day = ctx.clock('day');
	const currentMonth = day.today.slice(0, 7) + '-01';
	// a link may open one report (`?tab=`) and the aging on its own cutoff (`?as_of=`)
	const linked = new URL(location.href).searchParams;
	let salesBasis = $state<SalesBasis>('invoice');
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	let as_of = $state<string | null>(
		linked.get('as_of') ??
			DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(currentMonth), { days: 1 }))
	);
	let commissionMonth = $state<string | null>(currentMonth);
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	const salesThrough = $derived(
		salesTo
			? DateTime.formatIsoDateUtc(
					DateTime.endOf(DateTime.makeUnsafe(`${salesTo.slice(0, 7)}-01`), 'month')
				)
			: null
	);
	// each report shows to whoever reads its root: sales lines, invoices with payments, statements, credit
	const shown = $derived({
		sales: Boolean(ctx.catalog?.source_sales_lines),
		aging: Boolean(ctx.catalog?.transactions && ctx.catalog?.source_payments),
		commission: Boolean(ctx.catalog?.commission_statements),
		credit: Boolean(ctx.catalog?.credit_snapshots)
	});
	let chosenTab = $state<string | null>(linked.get('tab'));
	const tab = $derived(
		(['sales', 'aging', 'commission', 'credit'] as const).find(
			(name) => name === chosenTab && shown[name]
		) ??
			(['sales', 'aging', 'commission', 'credit'] as const).find((name) => shown[name]) ??
			null
	);
</script>

{#snippet sales()}
	{#if invalidSalesRange}<EmptyState tone="danger" title={ctx.t('errors.report_range')} />
	{:else}<SalesAnalysis {ctx} basis={salesBasis} from={salesFrom} to={salesThrough} />{/if}
{/snippet}
{#snippet aging()}<ReceivablesAging {ctx} as_of={as_of ?? day.today} />{/snippet}
{#snippet commission()}<CommissionBoard {ctx} period={commissionMonth ?? currentMonth} />{/snippet}
{#snippet credit()}<CreditExceptions {ctx} />{/snippet}

<AppShell
	description={ctx.t('app.analysis.description')}
	icon="lucide:chart-column"
	title={ctx.t('component.reports')}
	variant="full"
>
	{#snippet actions()}
		{#if tab === 'sales'}
			<div class="flex max-w-full flex-wrap items-center gap-2">
				<select
					aria-label={ctx.t('reports.sales.date_basis')}
					bind:value={salesBasis}
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				>
					<option value="invoice">{ctx.t('reports.sales.date_invoice')}</option>
					<option value="delivery">{ctx.t('reports.sales.date_delivery')}</option>
				</select>
				<TimeRangeInput
					{ctx}
					id="sales-range"
					of="date"
					precision="month"
					value={{ from: salesFrom, to: salesTo }}
					on_change={(range) => {
						const bounds = Schema.is(DateBounds)(range) ? range : { from: null, to: null };
						salesFrom = bounds.from;
						salesTo = bounds.to;
					}}
				/>
			</div>
		{:else if tab === 'aging'}
			<label class="flex w-44 flex-col gap-1 text-sm" for="ar-aging-date">
				{ctx.t('component.aging_as_of')}
				<TimeInput
					{ctx}
					id="ar-aging-date"
					value={as_of}
					on_change={(value: string | null) => (as_of = value)}
				/>
			</label>
		{:else if tab === 'commission'}
			<label class="w-40"
				><span class="sr-only">{ctx.t('models.commission_statements.fields.period')}</span
				><TimeInput
					{ctx}
					id="commission-month"
					of="date"
					precision="month"
					value={commissionMonth}
					on_change={(value: string | null) =>
						(commissionMonth = value ? value.slice(0, 7) + '-01' : null)}
				/></label
			>
		{/if}
	{/snippet}
	{#if tab !== null}<Tabs
			value={tab}
			on_value_change={(value) => (chosenTab = value)}
			tabs={[
				...(shown.sales
					? [{ name: 'sales', title: ctx.t('component.sales_analysis'), body: sales }]
					: []),
				...(shown.aging
					? [{ name: 'aging', title: ctx.t('component.ar_aging'), body: aging }]
					: []),
				...(shown.commission
					? [{ name: 'commission', title: ctx.t('component.commission'), body: commission }]
					: []),
				...(shown.credit
					? [{ name: 'credit', title: ctx.t('component.credit_exceptions'), body: credit }]
					: [])
			]}
		/>{:else}<EmptyState title={ctx.t('component.reports_access')} />{/if}
</AppShell>
