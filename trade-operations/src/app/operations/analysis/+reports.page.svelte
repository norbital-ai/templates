<script lang="ts">
	import { bolt } from '$bolt';
	import { marginSeries } from '../../../lib/financial-series.js';
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
	import { Schema } from 'effect';
	import type { QueryOutput } from '@norbital-ai/bolt';
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
	type MonthlyCommission = QueryOutput<'commission_statements.board'>[number];
	let monthSelection = $state<MonthlyCommission | null>(null);
	const monthEnd = (value: string) =>
		addDays(addMonths(PlainDate(value.slice(0, 7) + '-01'), 1), -1);
	let asOf = $state<string | null>(today);
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	const queries = $derived(kinds.catalog?.orders?.queries);
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	// a cleared date means today, which rolls over at midnight
	const day = bolt.clock('day');
	const agingDay = $derived(asOf ? PlainDate(asOf) : day.today);
	const detailRows = $derived(
		queries?.sales_detail && !invalidSalesRange
			? bolt.query('orders.sales_detail', {
					...(salesFrom ? { from: PlainDate(salesFrom) } : {}),
					...(salesTo ? { to: PlainDate(monthEnd(salesTo)) } : {})
				})
			: null
	);
	const agingRows = $derived(
		queries?.ar_aging ? bolt.query('orders.ar_aging', { as_of: agingDay }) : null
	);
	const paymentRows = $derived(
		kinds.catalog?.source_payments?.queries?.ledger
			? bolt.query('source_payments.ledger', { unapplied: true, as_of: agingDay })
			: null
	);
	const monthlyRows = $derived(
		kinds.catalog?.commission_statements?.queries?.board && commissionPeriod
			? bolt.query('commission_statements.board', { period: PlainDate(commissionPeriod) })
			: null
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
{#snippet agingOrder({ row }: { row: { order: string; order_number: string } })}<Button
		variant="link"
		onclick={() => openRecord('orders', row.order)}>{row.order_number}</Button
	>{/snippet}
{#snippet agingBill({
	row
}: {
	row: { invoice: string | null; invoice_number: string };
})}{#if row.invoice}<Button variant="link" onclick={() => openRecord('transactions', row.invoice!)}
			>{row.invoice_number}</Button
		>{:else}{row.invoice_number}{/if}{/snippet}
{#snippet salesDetail()}<Stack gap="md">
		{#if invalidSalesRange}<p role="alert">{bolt.t('errors.report_range')}</p>
		{:else if detailRows?.current}
			{@const rows = detailRows.current.map((row) => ({
				...row,
				freight_treatment_label: bolt.t(`reports.freight.${row.freight_treatment}`),
				kind_label: bolt.t(`reports.sales.kind.${row.kind}`)
			}))}
			{@const margins = marginSeries(detailRows.current)}
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
				{detailRows?.error ? detailRows.error.message : bolt.t('component.reports_loading')}
			</p>{/if}
	</Stack>{/snippet}
{#snippet aging()}<Stack gap="md">
		{#if agingRows?.current && paymentRows?.current}
			{@const rows = [
				...agingRows.current.map((row) => ({
					...row,
					bucket_label: bolt.t(`reports.aging.${row.bucket}`),
					not_due: row.bucket === 'not_due' ? row.balance : '0',
					'1_30': row.bucket === '1_30' ? row.balance : '0',
					'31_60': row.bucket === '31_60' ? row.balance : '0',
					'61_90': row.bucket === '61_90' ? row.balance : '0',
					over_90: row.bucket === 'over_90' ? row.balance : '0',
					no_due_date: row.bucket === 'no_due_date' ? row.balance : '0'
				})),
				...paymentRows.current.map((p) => ({
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
				{agingRows?.error?.message ??
					paymentRows?.error?.message ??
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
		{#if monthlyRows?.current}
			{@const rows = monthlyRows.current.map((row) => ({
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
		{:else}<p role="status">
				{monthlyRows?.error ? monthlyRows.error.message : bolt.t('component.reports_loading')}
			</p>{/if}
	</Stack>{/snippet}
<AppShell
	description={bolt.t('app.analysis.description')}
	icon="lucide:chart-column"
	title={bolt.t('component.reports')}
	variant="full"
	>{#if queries?.sales_detail || queries?.ar_aging || kinds.catalog?.commission_statements?.queries?.board}<Tabs
			tabs={[
				...(queries?.sales_detail
					? [{ name: 'sales', title: bolt.t('component.sales_analysis'), body: salesDetail }]
					: []),
				...(queries?.ar_aging
					? [{ name: 'aging', title: bolt.t('component.ar_aging'), body: aging }]
					: []),
				...(kinds.catalog?.commission_statements?.queries?.board
					? [{ name: 'commission', title: bolt.t('component.commission'), body: monthlyCommission }]
					: [])
			]}
		/>{:else}<p>{bolt.t('component.reports_access')}</p>{/if}</AppShell
>
