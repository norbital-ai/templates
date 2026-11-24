<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, EmptyState, Label, Tabs, TimeInput, TimeRangeInput } from '@norbital-ai/ui';
	import { AppShell, Cluster, Inline } from '@norbital-ai/ui/layout';
	import { DateTime, Schema } from 'effect';
	import type { SalesBasis } from '../../../lib/reports.js';
	import SalesAnalysis from './sales-analysis.svelte';
	import PurchaseListing from './purchase-listing.svelte';
	import ReceivablesAging from './receivables-aging.svelte';
	import PayablesAging from './payables-aging.svelte';
	import CommissionBoard from './commission-board.svelte';
	import CreditExceptions from './credit-exceptions.svelte';
	let { ctx }: { ctx: PageContext } = $props();
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	// the page scope each report reads: sales/purchase periods, AR/AP aging cutoffs (last month-end), commission month
	const day = ctx.clock('day');
	const currentMonth = day.today.slice(0, 7) + '-01';
	const lastMonthEnd = DateTime.formatIsoDateUtc(
		DateTime.subtract(DateTime.makeUnsafe(currentMonth), { days: 1 })
	);
	// a link may open one report (`?tab=`) and the aging on its own cutoff (`?as_of=`)
	const linked =
		typeof location === 'undefined' ? new URLSearchParams() : new URL(location.href).searchParams;
	let salesBasis = $state<SalesBasis>('invoice');
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	let purchaseFrom = $state<string | null>(currentMonth);
	let purchaseTo = $state<string | null>(currentMonth);
	let as_of = $state<string | null>(linked.get('as_of') ?? lastMonthEnd);
	let payablesAsOf = $state<string | null>(linked.get('as_of') ?? lastMonthEnd);
	let commissionMonth = $state<string | null>(currentMonth);
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	const invalidPurchaseRange = $derived(
		Boolean(purchaseFrom && purchaseTo && purchaseFrom > purchaseTo)
	);
	const monthEndOf = (month: string | null) =>
		month
			? DateTime.formatIsoDateUtc(
					DateTime.endOf(DateTime.makeUnsafe(`${month.slice(0, 7)}-01`), 'month')
				)
			: null;
	const salesThrough = $derived(monthEndOf(salesTo));
	const purchaseThrough = $derived(monthEndOf(purchaseTo));
	// each report shows to whoever reads its root: sales lines, purchase orders, AR/AP, statements, credit
	const shown = $derived({
		sales: Boolean(ctx.catalog?.source_sales_lines),
		purchases: Boolean(ctx.catalog?.source_purchase_orders),
		aging: Boolean(ctx.catalog?.transactions && ctx.catalog?.source_payments),
		payables: Boolean(ctx.catalog?.source_payables),
		commission: Boolean(ctx.catalog?.commission_statements),
		credit: Boolean(ctx.catalog?.credit_snapshots || ctx.catalog?.credit_releases)
	});
	const tabNames = ['sales', 'purchases', 'aging', 'payables', 'commission', 'credit'] as const;
	let chosenTab = $state<string | null>(linked.get('tab'));
	const tab = $derived(
		tabNames.find((name) => name === chosenTab && shown[name]) ??
			tabNames.find((name) => shown[name]) ??
			null
	);
</script>

{#snippet sales()}
	{#if invalidSalesRange}<EmptyState tone="danger" title={ctx.t('errors.report_range')} />
	{:else}<SalesAnalysis {ctx} basis={salesBasis} from={salesFrom} to={salesThrough} />{/if}
{/snippet}
{#snippet purchases()}
	{#if invalidPurchaseRange}<EmptyState tone="danger" title={ctx.t('errors.report_range')} />
	{:else}<PurchaseListing {ctx} from={purchaseFrom} to={purchaseThrough} />{/if}
{/snippet}
{#snippet aging()}<ReceivablesAging {ctx} as_of={as_of ?? day.today} />{/snippet}
{#snippet payables()}<PayablesAging {ctx} as_of={payablesAsOf ?? day.today} />{/snippet}
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
			<Cluster gap="sm" align="center">
				<Inline gap="sm" align="center">
					<Label for="sales-date-basis">{ctx.t('reports.sales.date_basis')}</Label>
					<Combobox
						id="sales-date-basis"
						value={salesBasis}
						options={[
							{ value: 'invoice', label: ctx.t('reports.sales.date_invoice') },
							{ value: 'delivery', label: ctx.t('reports.sales.date_delivery') }
						]}
						on_change={(value) => {
							if (value !== null) salesBasis = value;
						}}
					/>
				</Inline>
				<Inline gap="sm" align="center">
					<Label for="sales-range">{ctx.t('reports.period')}</Label>
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
				</Inline>
			</Cluster>
		{:else if tab === 'purchases'}
			<Inline gap="sm" align="center">
				<Label for="purchase-range">{ctx.t('reports.period')}</Label>
				<TimeRangeInput
					{ctx}
					id="purchase-range"
					of="date"
					precision="month"
					value={{ from: purchaseFrom, to: purchaseTo }}
					on_change={(range) => {
						const bounds = Schema.is(DateBounds)(range) ? range : { from: null, to: null };
						purchaseFrom = bounds.from;
						purchaseTo = bounds.to;
					}}
				/>
			</Inline>
		{:else if tab === 'aging'}
			<Inline gap="sm" align="center">
				<Label for="ar-aging-date">{ctx.t('component.aging_as_of')}</Label>
				<TimeInput
					{ctx}
					id="ar-aging-date"
					value={as_of}
					on_change={(value: string | null) => (as_of = value)}
				/>
			</Inline>
		{:else if tab === 'payables'}
			<Inline gap="sm" align="center">
				<Label for="ap-aging-date">{ctx.t('component.aging_as_of')}</Label>
				<TimeInput
					{ctx}
					id="ap-aging-date"
					value={payablesAsOf}
					on_change={(value: string | null) => (payablesAsOf = value)}
				/>
			</Inline>
		{:else if tab === 'commission'}
			<Inline gap="sm" align="center">
				<Label for="commission-month">{ctx.t('models.commission_statements.fields.period')}</Label>
				<TimeInput
					{ctx}
					id="commission-month"
					of="date"
					precision="month"
					value={commissionMonth}
					on_change={(value: string | null) =>
						(commissionMonth = value ? value.slice(0, 7) + '-01' : null)}
				/>
			</Inline>
		{/if}
	{/snippet}
	{#if tab !== null}<Tabs
			value={tab}
			on_value_change={(value) => (chosenTab = value)}
			tabs={[
				...(shown.sales
					? [{ name: 'sales', title: ctx.t('component.sales_analysis'), body: sales }]
					: []),
				...(shown.purchases
					? [{ name: 'purchases', title: ctx.t('component.purchase_listing'), body: purchases }]
					: []),
				...(shown.aging
					? [{ name: 'aging', title: ctx.t('component.ar_aging'), body: aging }]
					: []),
				...(shown.payables
					? [{ name: 'payables', title: ctx.t('component.ap_aging'), body: payables }]
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
