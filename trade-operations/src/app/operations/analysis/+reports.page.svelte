<script lang="ts">
	import { bolt, run } from '$bolt';
	import { marginSeries } from '../../../lib/financial-series.js';
	import {
		agingRead,
		arAging,
		ledgerRead,
		paymentLedger,
		salesDetail,
		salesRead
	} from '../../../lib/reports.js';
	import { boardRead, commissionBoard, monthOf } from '../../../lib/monthly-commission.js';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { PlainDate, addDays, addMonths } from '@norbital-ai/std/date';
	import { localOf } from '@norbital-ai/std/zone';
	import {
		Dialog,
		Table,
		Tabs,
		useKinds,
		Show,
		Button,
		openRecord,
		Form,
		label,
		TimeInput,
		TimeRangeInput,
		Badge,
		Chart,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Effect, Schema } from 'effect';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	const kinds = useKinds();
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const today = localOf(
		Date.now(),
		kinds.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	).date;
	const currentMonth = today.slice(0, 7) + '-01';
	let commissionPeriod = $state<string | null>(currentMonth);
	type MonthlyCommission = Effect.Success<ReturnType<typeof commissionBoard>>[number];
	let monthSelection = $state<MonthlyCommission | null>(null);
	const monthEnd = (value: string) =>
		addDays(addMonths(PlainDate(value.slice(0, 7) + '-01'), 1), -1);
	let asOf = $state<string | null>(today);
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	// each report shows to whoever reads its root: sales lines, invoices with payments, statements
	const salesShown = $derived(Boolean(kinds.catalog?.source_sales_lines));
	const agingShown = $derived(
		Boolean(kinds.catalog?.transactions && kinds.catalog?.source_payments)
	);
	const boardShown = $derived(Boolean(kinds.catalog?.commission_statements));
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	// a cleared date means today, which rolls over at midnight
	const day = bolt.clock('day');
	const agingDay = $derived(asOf ? PlainDate(asOf) : day.today);
	const futureAging = $derived(agingDay > day.today);
	const sales = $derived(salesShown ? bolt.query(salesRead) : null);
	const detailRows = $derived(
		sales?.current && !invalidSalesRange
			? salesDetail(sales.current, {
					from: salesFrom ? PlainDate(salesFrom) : null,
					to: salesTo ? PlainDate(monthEnd(salesTo)) : null
				})
			: null
	);
	const agingAnswer = $derived(agingShown && !futureAging ? bolt.query(agingRead(agingDay)) : null);
	const agingRows = $derived(agingAnswer?.current ? arAging(agingAnswer.current, agingDay) : null);
	const paymentAnswer = $derived(
		agingShown && !futureAging ? bolt.query(ledgerRead({ as_of: agingDay })) : null
	);
	const paymentRows = $derived(
		paymentAnswer?.current ? paymentLedger(paymentAnswer.current, { unapplied: true }) : null
	);
	const period = $derived(commissionPeriod ? monthOf(commissionPeriod) : null);
	const boardAnswer = $derived(boardShown && period ? bolt.query(boardRead(period)) : null);
	// the board hashes each calculation, so it resolves once the read has answered
	const monthlyRows = $derived(
		boardAnswer?.current && period ? run(commissionBoard(boardAnswer.current, period)) : null
	);
</script>

{#snippet salesRange()}<div class="max-w-full">
		<span class="sr-only">{bolt.t('component.sales_analysis')}</span><TimeRangeInput
			id="sales-range"
			of="date"
			precision="month"
			value={{ from: salesFrom, to: salesTo }}
			onChange={(range) => {
				if (Schema.is(DateBounds)(range)) {
					salesFrom = range.from;
					salesTo = range.to;
				} else {
					salesFrom = null;
					salesTo = null;
				}
			}}
		/>
	</div>{/snippet}
{#snippet agingDate()}<label class="w-44"
		><span class="sr-only">{bolt.t('component.aging_as_of')}</span><TimeInput
			id="ar-aging-date"
			value={asOf}
			onChange={(value: string | null) => (asOf = value)}
		/></label
	>{/snippet}
{#snippet commissionMonth()}<label class="w-40"
		><span class="sr-only">{bolt.t('models.commission_statements.fields.period')}</span><TimeInput
			id="commission-month"
			of="date"
			precision="month"
			value={commissionPeriod}
			onChange={(value: string | null) =>
				(commissionPeriod = value ? value.slice(0, 7) + '-01' : null)}
		/></label
	>{/snippet}
{#snippet enumCell({ value }: { value: ShowProps['value'] })}<Badge variant="outline"
		>{String(value ?? '—')}</Badge
	>{/snippet}

{#snippet money({
	value,
	row
}: {
	value: ShowProps['value'];
	row: NonNullable<ShowProps['row']>;
})}<Show kind={moneyKind} {value} {row} />{/snippet}
{#snippet decimal({ value }: { value: ShowProps['value'] })}<Show
		kind={{ kind: 'decimal', scale: 8 }}
		{value}
	/>{/snippet}
{#snippet date({ value }: { value: ShowProps['value'] })}<Show
		kind={{ kind: 'date' }}
		{value}
	/>{/snippet}
{#snippet agingOrder({
	row
}: {
	row: { order: string | null; order_number: string };
})}{#if row.order}<Button variant="link" onclick={() => openRecord('orders', row.order!)}
			>{row.order_number}</Button
		>{:else}{row.order_number}{/if}{/snippet}
{#snippet agingBill({
	row
}: {
	row: { invoice: string | null; invoice_number: string };
})}{#if row.invoice}<Button variant="link" onclick={() => openRecord('transactions', row.invoice!)}
			>{row.invoice_number}</Button
		>{:else}{row.invoice_number}{/if}{/snippet}
{#snippet salesTab()}<Stack gap="md">
		{#if invalidSalesRange}<p role="alert">{bolt.t('errors.report_range')}</p>
		{:else if detailRows}
			{@const rows = detailRows.map((row) => ({
				...row,
				freight_treatment_label: bolt.t(`reports.freight.${row.freight_treatment}`),
				kind_label: bolt.t(`reports.sales.kind.${row.kind}`)
			}))}
			{@const margins = marginSeries(detailRows)}
			{#each [...new Set(margins.map((r) => r.currency))] as currency}
				<Chart
					of={margins.filter((r) => r.currency === currency)}
					x="salesperson"
					y="margin"
					orientation="horizontal"
					title={`${bolt.t('component.actual_margins')} · ${currency}`}
				/>
			{/each}
			{#if margins.some((r) => r.margin === null)}<p class="text-sm text-muted-foreground">
					{bolt.t('component.unpriced_margin')}
				</p>{/if}
			<Table
				layout="grid"
				of={rows}
				key="sales_detail"
				columns={[
					{ field: 'order_number', label: bolt.t('models.orders.singular'), cell: agingOrder },
					{ field: 'reference', label: bolt.t('reports.sales.reference') },
					{ field: 'business_on', label: bolt.t('reports.sales.business_on'), cell: date },
					{ field: 'party_name', label: label(bolt, 'orders', 'party_name') },
					{ field: 'product_name', label: bolt.t('reports.sales.product') },
					{ field: 'owner_name', label: label(bolt, 'orders', 'owner_name') },
					{ field: 'kind_label', label: bolt.t('reports.sales.kind'), cell: enumCell },
					{
						field: 'quantity',
						kind: { kind: 'decimal', scale: 3 },
						label: label(bolt, 'orders', 'quantity'),
						align: 'end' as const,
						cell: decimal
					},
					{ field: 'unit', label: bolt.t('reports.sales.unit') },
					{ field: 'lot_number', label: bolt.t('models.stock_snapshots.fields.lot_number') },
					{ field: 'currency', label: label(bolt, 'orders', 'currency') },
					{ field: 'freight_treatment_label', label: bolt.t('reports.sales.freight_treatment') },
					...(['net', 'tax', 'total', 'freight', 'cost', 'margin'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: bolt.t(`reports.sales.${field}`),
						align: 'end' as const,
						cell: money
					}))
				]}
				toolbar={{ new: false, export: true, controls: salesRange }}
			/>
		{:else}<p role="status">
				{sales?.error ? sales.error.message : bolt.t('component.reports_loading')}
			</p>{/if}
	</Stack>{/snippet}
{#snippet aging()}<Stack gap="md">
		{#if futureAging}<p role="alert">{bolt.t('errors.report_future')}</p>
		{:else if agingRows && paymentRows}
			{@const rows = [
				...agingRows.map((row) => ({
					...row,
					bucket_label: bolt.t(`reports.aging.${row.bucket}`),
					not_due: row.bucket === 'not_due' ? row.balance : '0',
					'1_30': row.bucket === '1_30' ? row.balance : '0',
					'31_60': row.bucket === '31_60' ? row.balance : '0',
					'61_90': row.bucket === '61_90' ? row.balance : '0',
					over_90: row.bucket === 'over_90' ? row.balance : '0',
					no_due_date: row.bucket === 'no_due_date' ? row.balance : '0'
				})),
				...paymentRows.map((p) => ({
					order: p.order,
					order_number: p.order_number,
					invoice: null,
					invoice_number: p.reference,
					party_name: p.party_name,
					currency: p.currency,
					due_on: null,
					balance: Decimal.of(p.amount).neg().toString(),
					overpaid: '0',
					bucket_label: bolt.t('component.unallocated_credit'),
					not_due: '0',
					'1_30': '0',
					'31_60': '0',
					'61_90': '0',
					over_90: '0',
					no_due_date: '0'
				}))
			]}
			<Table
				layout="grid"
				of={rows}
				key="ar_aging"
				columns={[
					{ field: 'bucket_label', label: bolt.t('models.orders.fields.status'), cell: enumCell },
					{ field: 'order_number', label: bolt.t('models.orders.singular'), cell: agingOrder },
					{
						field: 'invoice_number',
						label: bolt.t('models.source_payments.fields.invoice'),
						cell: agingBill
					},
					...(['party_name', 'currency'] as const).map((field) => ({
						field,
						label: label(bolt, 'orders', field)
					})),
					...(['due_on'] as const).map((field) => ({
						field,
						label: label(bolt, 'orders', field),
						cell: date
					})),
					...(['balance', 'overpaid'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: label(bolt, 'orders', field),
						align: 'end' as const,
						cell: money
					})),
					...(['not_due', '1_30', '31_60', '61_90', 'over_90', 'no_due_date'] as const).map(
						(field) => ({
							field,
							kind: moneyKind,
							label: bolt.t(`reports.aging.${field}`),
							align: 'end' as const,
							cell: money
						})
					)
				]}
				toolbar={{ new: false, export: true, controls: agingDate }}
			/>
		{:else}<p role="status">
				{agingAnswer?.error?.message ??
					paymentAnswer?.error?.message ??
					bolt.t('component.reports_loading')}
			</p>{/if}
	</Stack>{/snippet}
{#snippet monthActions({ row }: { row: MonthlyCommission })}
	{#if row.latest_statement}<Button
			variant="link"
			onclick={() => openRecord('commission_statements', row.latest_statement!)}
			>{bolt.t('component.monthly_commission_statement')}</Button
		>{/if}
	{#if kinds.catalog?.commission_statements?.create && ['unacknowledged', 'changed'].includes(row.state)}<Button
			onclick={() => (monthSelection = row)}>{bolt.t('component.commission_acknowledge')}</Button
		>{/if}
{/snippet}
{#snippet monthlyCommission()}<Stack gap="md">
		{#if monthlyRows}{#await monthlyRows}<p role="status">{bolt.t('component.reports_loading')}</p>
			{:then monthly}
				{@const rows = monthly.map((row) => ({
					...row,
					state_label: bolt.t(`reports.commission_ack.${row.state}`)
				}))}
				<Table
					layout="grid"
					of={rows}
					key="monthly_commission"
					columns={[
						{ field: 'owner_name', label: label(bolt, 'orders', 'owner_name') },
						{ field: 'currency', label: label(bolt, 'orders', 'currency') },
						{ field: 'order_count', label: label(bolt, 'commission_statements', 'order_count') },
						{
							field: 'amount',
							kind: moneyKind,
							label: label(bolt, 'orders', 'amount'),
							align: 'end' as const,
							cell: money
						},
						{
							field: 'latest_amount',
							kind: moneyKind,
							label: bolt.t('component.commission_previous'),
							align: 'end' as const,
							cell: money
						},
						{ field: 'unresolved_lines', label: bolt.t('component.commission_unresolved_items') },

						{ field: 'state_label', label: label(bolt, 'orders', 'status'), cell: enumCell },
						{
							field: 'owner',
							label: bolt.t('component.monthly_commission_statement'),
							cell: monthActions
						}
					]}
					toolbar={{ new: false, export: true, controls: commissionMonth }}
				/>
				{#if monthSelection && rows.some((row) => row.calculation_hash === monthSelection?.calculation_hash && ['unacknowledged', 'changed'].includes(row.state))}
					<Dialog.Root
						open={monthSelection !== null}
						onOpenChange={(open) => {
							if (!open) monthSelection = null;
						}}
						><Dialog.Content
							><Dialog.Title>{bolt.t('component.monthly_commission_statement')}</Dialog.Title>
							<p>
								{monthSelection.owner_name} · {monthSelection.period.slice(0, 7)} · <Show
									kind={{ kind: 'money', currency: 'currency' }}
									value={monthSelection.amount}
									row={monthSelection}
								/>
							</p>
							<Form
								of="commission_statements"
								mode="create"
								values={{
									owner: monthSelection.owner,
									period: monthSelection.period,
									currency: monthSelection.currency,
									calculation_hash: monthSelection.calculation_hash
								}}
								fields={[]}
								submit={bolt.t('component.commission_acknowledge')}
								onOutcome={() => (monthSelection = null)}
							/>
						</Dialog.Content></Dialog.Root
					>
				{/if}
			{:catch failure}<p role="status">
					{failure instanceof Error ? failure.message : String(failure)}
				</p>{/await}
		{:else}<p role="status">
				{boardAnswer?.error ? boardAnswer.error.message : bolt.t('component.reports_loading')}
			</p>{/if}
	</Stack>{/snippet}
<AppShell
	description={bolt.t('app.analysis.description')}
	icon="lucide:chart-column"
	title={bolt.t('component.reports')}
	variant="full"
	>{#if salesShown || agingShown || boardShown}<Tabs
			tabs={[
				...(salesShown
					? [{ name: 'sales', title: bolt.t('component.sales_analysis'), body: salesTab }]
					: []),
				...(agingShown
					? [{ name: 'aging', title: bolt.t('component.ar_aging'), body: aging }]
					: []),
				...(boardShown
					? [{ name: 'commission', title: bolt.t('component.commission'), body: monthlyCommission }]
					: [])
			]}
		/>{:else}<p>{bolt.t('component.reports_access')}</p>{/if}</AppShell
>
