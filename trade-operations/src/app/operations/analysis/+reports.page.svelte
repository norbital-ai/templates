<script lang="ts">
	import { bolt, run } from '$bolt';
	import { marginSeries } from '../../../lib/financial-series.js';
	import {
		agingBuckets,
		agingDetails,
		agingGroup,
		agingRead,
		agingSummary,
		estimateAging,
		receivablesRead,
		salesDetail,
		salesReadDuring,
		type SalesBasis
	} from '../../../lib/reports.js';
	import { earliestReceivablesCutoff } from '../../../lib/receivables.js';
	import { xlsxWorkbook, type XlsxColumn } from '../../../lib/xlsx.js';
	import { boardRead, commissionBoard, monthOf } from '../../../lib/monthly-commission.js';
	import { PlainDate, addDays, addMonths } from '@norbital-ai/std/date';
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
		EmptyState,
		type Col,
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
	const costKind: Kind = { kind: 'money', currency: 'cost_currency', optional: true };
	// a cleared date means today, which rolls over at midnight
	const day = bolt.clock('day');
	const currentMonth = day.today.slice(0, 7) + '-01';
	let commissionPeriod = $state<string | null>(currentMonth);
	type MonthlyCommission = Effect.Success<ReturnType<typeof commissionBoard>>[number];
	let monthSelection = $state<MonthlyCommission | null>(null);
	const monthEnd = (value: string) =>
		addDays(addMonths(PlainDate(value.slice(0, 7) + '-01'), 1), -1);
	let asOf = $state<string | null>(day.today);
	let agingView = $state<'customers' | 'entries'>('customers');
	let agingBasis = $state<'estimated' | 'gross'>('estimated');
	let agingCustomer = $state<{ key: string; name: string } | null>(null);
	let salesBasis = $state<SalesBasis>('invoice');
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	// each report shows to whoever reads its root: sales lines, invoices with payments, statements
	const salesShown = $derived(Boolean(kinds.catalog?.source_sales_lines));
	const agingShown = $derived(
		Boolean(kinds.catalog?.transactions && kinds.catalog?.source_payments)
	);
	const boardShown = $derived(Boolean(kinds.catalog?.commission_statements));
	// the header shows the open tab's scope
	let chosenTab = $state<string | null>(null);
	const tab = $derived(
		chosenTab ?? (salesShown ? 'sales' : agingShown ? 'aging' : boardShown ? 'commission' : null)
	);
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	const agingDay = $derived(asOf ? PlainDate(asOf) : day.today);
	const futureAging = $derived(agingDay > day.today);
	const sales = $derived(
		salesShown && !invalidSalesRange
			? bolt.query(
					salesReadDuring(
						{
							basis: salesBasis,
							from: salesFrom ? PlainDate(salesFrom) : null,
							to: salesTo ? PlainDate(monthEnd(salesTo)) : null
						},
						kinds.catalog?.source_sales_lines?.output === 'commercial'
					)
				)
			: null
	);
	const detailRows = $derived(
		sales?.current ? salesDetail(sales.current, { basis: salesBasis }) : null
	);
	const agingSources = $derived(
		agingShown && kinds.catalog?.source_receivables ? bolt.query(receivablesRead) : null
	);
	const snapshots = $derived(agingSources?.current?.source_receivables.rows ?? []);
	const showAgingEstimate = $derived(snapshots.length > 0 && agingBasis === 'estimated');
	const coveredLedgers = $derived(snapshots.flatMap((snapshot) => snapshot.source?.id ?? []));
	const earlyAging = $derived(snapshots.length > 0 && agingDay < earliestReceivablesCutoff);
	const agingAnswer = $derived(
		agingShown && !futureAging && !earlyAging && (!agingSources || agingSources.current)
			? bolt.query(agingRead(agingDay, coveredLedgers))
			: null
	);
	const agingScope = $derived(
		bolt.t(
			showAgingEstimate
				? 'reports.aging.estimate_scope'
				: snapshots.length
					? 'reports.aging.account_scope'
					: 'reports.aging.cutoff_scope'
		)
	);
	const agingIncomplete = $derived(
		Boolean(
			agingAnswer?.current?.transactions.next ||
			agingAnswer?.current?.source_payments.next ||
			agingSources?.current?.source_receivables.next
		)
	);
	const agingFacts = $derived(
		agingAnswer?.current && !agingIncomplete
			? agingDetails(agingAnswer.current, agingDay, snapshots)
			: null
	);
	const agingRows = $derived(
		agingFacts && showAgingEstimate ? estimateAging(agingFacts) : agingFacts
	);
	const agingCustomers = $derived(agingRows ? agingSummary(agingRows) : null);
	const visibleAgingRows = $derived(
		agingRows?.filter((row) => !agingCustomer || agingGroup(row) === agingCustomer.key)
	);
	const period = $derived(commissionPeriod ? monthOf(commissionPeriod) : null);
	const boardAnswer = $derived(
		boardShown && period
			? bolt.query(boardRead(period, kinds.catalog?.source_sales_lines?.output === 'commercial'))
			: null
	);
	// the board hashes each calculation, so it resolves once the read has answered
	const monthlyRows = $derived(
		boardAnswer?.current && period ? run(commissionBoard(boardAnswer.current, period)) : null
	);
	const downloadWorkbook = (
		name: string,
		columns: readonly (
			| XlsxColumn
			| string
			| {
					readonly field: string;
					readonly label?: string;
					readonly kind?: { readonly kind?: string; readonly scale?: number };
			  }
		)[],
		rows: readonly { readonly [field: string]: unknown }[]
	) => {
		const shaped = columns.map((column) => {
			if (typeof column === 'string') return { field: column, label: column, numeric: false };
			const kind =
				'kind' in column && column.kind
					? (column.kind as { kind?: string; scale?: number })
					: undefined;
			const numeric =
				('numeric' in column && column.numeric === true) ||
				kind?.kind === 'money' ||
				kind?.kind === 'decimal';
			const scale =
				'scale' in column && typeof column.scale === 'number'
					? column.scale
					: kind?.kind === 'money'
						? 2
						: kind?.scale;
			return {
				field: String(column.field),
				label: column.label ?? String(column.field),
				numeric,
				...(scale === undefined ? {} : { scale })
			};
		});
		const bytes = xlsxWorkbook(name, shaped, rows);
		const url = URL.createObjectURL(
			new Blob([bytes], {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${name}-${day.today}.xlsx`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
</script>

{#snippet salesRange()}<div class="flex max-w-full flex-wrap items-center gap-2">
		<select
			aria-label={bolt.t('reports.sales.date_basis')}
			bind:value={salesBasis}
			class="h-9 rounded-md border border-input bg-background px-2 text-sm"
		>
			<option value="invoice">{bolt.t('reports.sales.date_invoice')}</option>
			<option value="delivery">{bolt.t('reports.sales.date_delivery')}</option>
		</select>
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
{#snippet deliveryCost({
	value,
	row
}: {
	value: ShowProps['value'];
	row: NonNullable<ShowProps['row']>;
})}
	<Show kind={costKind} {value} {row} />
{/snippet}
{#snippet decimal({ value }: { value: ShowProps['value'] })}<Show
		kind={{ kind: 'decimal', scale: 8 }}
		{value}
	/>{/snippet}
{#snippet date({ value }: { value: ShowProps['value'] })}<Show
		kind={{ kind: 'date' }}
		{value}
	/>{/snippet}
{#snippet salesOrderCell({ row }: { row: ReturnType<typeof salesDetail>[number] })}
	{#if row.order}
		{@const order = row.order}
		<button
			type="button"
			class="underline-offset-4 hover:underline focus-visible:underline"
			onclick={() => openRecord('orders', order)}
		>
			{row.order_number}
		</button>
	{/if}
{/snippet}
{#snippet salesTab()}<Stack gap="md">
		{#if invalidSalesRange}<EmptyState tone="danger" title={bolt.t('errors.report_range')} />
		{:else if detailRows?.length}
			{@const rows = detailRows.map((row) => ({
				...row,
				freight_treatment_label: row.freight_treatment
					? bolt.t(`reports.freight.${row.freight_treatment}`)
					: '',
				kind_label: bolt.t(`reports.sales.kind.${row.kind}`)
			}))}
			{@const margins = marginSeries(detailRows)}
			{@const hasCost = rows.some((row) => row.cost !== null)}
			{@const separateCostCurrency = rows.some(
				(row) => row.cost_currency && row.cost_currency !== row.currency
			)}
			{@const knownMargins = margins.filter((row) => row.margin !== null)}
			{#each [...new Set(knownMargins.map((r) => r.currency))] as currency}
				<Chart
					of={knownMargins.filter((r) => r.currency === currency)}
					x="salesperson"
					y="margin"
					orientation="horizontal"
					title={`${bolt.t('component.actual_margins')} · ${currency}`}
				/>
			{/each}
			{@const salesColumns: readonly Col<(typeof rows)[number]>[] = [
					{ field: 'order_number', label: bolt.t('models.orders.singular'), cell: salesOrderCell },
					{ field: 'reference', label: bolt.t('reports.sales.reference') },
					{
						field: 'business_on',
						label: bolt.t(
							salesBasis === 'invoice'
								? 'reports.sales.date_invoice'
								: 'reports.sales.date_delivery'
						),
						cell: date
					},
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
					...(['sold_price', 'floor_net'] as const).map((field) => ({
						field,
						kind: { kind: 'decimal' as const, scale: 8 },
						label: bolt.t(`reports.sales.${field}`),
						align: 'end' as const,
						cell: decimal
					})),
					...(['source_net', 'net', 'tax', 'total', 'freight'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: bolt.t(`reports.sales.${field}`),
						align: 'end' as const,
						cell: money
					})),
					...(hasCost
						? [
								{
									field: 'cost' as const,
									kind: costKind,
									label: bolt.t('reports.sales.cost'),
									align: 'end' as const,
									cell: deliveryCost
								}
							]
						: []),
					...(separateCostCurrency
						? [{ field: 'cost_currency' as const, label: bolt.t('reports.sales.cost_currency') }]
						: []),
					{
						field: 'margin',
						kind: moneyKind,
						label: bolt.t('reports.sales.margin'),
						align: 'end',
						cell: money
					}
				]}
			<Table
				layout="grid"
				of={rows}
				key="sales_detail"
				columns={salesColumns}
				toolbar={{
					new: false,
					export: true,
					description: bolt.t('component.unpriced_margin'),
					actions: [
						{
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('component.export_xlsx'),
							run: () => downloadWorkbook('sales-analysis', salesColumns, rows)
						}
					]
				}}
			/>
		{:else if detailRows}<EmptyState
				title={bolt.t(
					salesBasis === 'invoice' ? 'reports.sales.no_invoices' : 'reports.sales.no_deliveries'
				)}
			/>
		{:else if sales?.error}<EmptyState tone="danger" title={sales.error.message} />
		{:else}<EmptyState title={bolt.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
{#snippet agingReference({ row }: { row: ReturnType<typeof agingDetails>[number] })}
	{#if row.invoice || row.order}
		<button
			type="button"
			class="underline-offset-4 hover:underline focus-visible:underline"
			onclick={() => {
				if (row.invoice) openRecord('transactions', row.invoice);
				else if (row.order) openRecord('orders', row.order);
			}}>{row.reference}</button
		>
	{:else}{row.reference}{/if}
{/snippet}
{#snippet agingControls()}<div class="flex max-w-full flex-wrap items-end gap-2">
		<label class="flex w-44 flex-col gap-1 text-sm" for="ar-aging-date">
			{bolt.t('component.aging_as_of')}
			<TimeInput
				id="ar-aging-date"
				value={asOf}
				onChange={(value: string | null) => (asOf = value)}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{bolt.t('reports.aging.view')}
			<select
				bind:value={agingView}
				onchange={() => (agingCustomer = null)}
				class="h-9 rounded-md border border-input bg-background px-2"
			>
				<option value="customers">{bolt.t('reports.aging.customers')}</option>
				<option value="entries">{bolt.t('reports.aging.entries')}</option>
			</select>
		</label>
		{#if snapshots.length}
			<label class="flex flex-col gap-1 text-sm">
				{bolt.t('reports.aging.basis')}
				<select
					bind:value={agingBasis}
					class="h-9 rounded-md border border-input bg-background px-2"
				>
					<option value="estimated">{bolt.t('reports.aging.basis_estimated')}</option>
					<option value="gross">{bolt.t('reports.aging.basis_gross')}</option>
				</select>
			</label>
		{/if}
		{#if agingCustomer}
			<Button
				variant="outline"
				onclick={() => {
					agingCustomer = null;
					agingView = 'customers';
				}}
			>
				{bolt.t('reports.aging.all_customers')}
			</Button>
		{/if}
	</div>
{/snippet}
{#snippet aging()}<Stack gap="md">
		{#each snapshots as snapshot (snapshot.id)}
			<p class="text-sm text-muted-foreground">
				{snapshot.source?.name} · {bolt.t('reports.aging.snapshot_at')}
				<Show kind={{ kind: 'instant' }} value={snapshot.observed_at} />
			</p>
		{/each}
		{#if agingCustomer}<p class="text-sm font-medium">{agingCustomer.name}</p>{/if}
		{#if futureAging}<EmptyState tone="danger" title={bolt.t('errors.report_future')} />
		{:else if earlyAging}<EmptyState tone="danger" title={bolt.t('reports.aging.early_cutoff')} />
		{:else if agingSources?.error}<EmptyState tone="danger" title={agingSources.error.message} />
		{:else if agingIncomplete}<EmptyState
				tone="danger"
				title={bolt.t('reports.aging.incomplete')}
			/>
		{:else if agingView === 'customers' && agingCustomers?.length}
			{@const agingCustomerColumns: readonly Col<NonNullable<typeof agingCustomers>[number]>[] = [
					{ field: 'party_name', label: label(bolt, 'orders', 'party_name') },
					...(['net', 'balance', 'unapplied', 'credit', 'overpaid'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: bolt.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					})),
					{ field: 'ledger_name', label: bolt.t('reports.aging.ledger') },
					{ field: 'currency', label: label(bolt, 'orders', 'currency') },
					{ field: 'as_of', label: bolt.t('component.aging_as_of'), cell: date },
					...(showAgingEstimate
						? [
								{
									field: 'estimated_balance' as const,
									kind: moneyKind,
									label: bolt.t('reports.aging.estimated_balance'),
									align: 'end' as const,
									cell: money
								}
							]
						: []),
					...agingBuckets.map((field) => ({
						field,
						kind: moneyKind,
						label: bolt.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					}))
				]}
			<Table
				layout="grid"
				of={agingCustomers}
				key="ar_customers"
				onOpen={(row) => {
					agingCustomer = {
						key: row.group,
						name: [row.party_name, row.ledger_name, row.currency].filter(Boolean).join(' · ')
					};
					agingView = 'entries';
				}}
				columns={agingCustomerColumns}
				toolbar={{
					new: false,
					export: true,
					description: agingScope,
					actions: [
						{
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('component.export_xlsx'),
							run: () =>
								downloadWorkbook('ar-aging-customers', agingCustomerColumns, agingCustomers)
						}
					]
				}}
			/>
		{:else if agingView === 'entries' && visibleAgingRows?.length}
			{@const agingEntryRows = visibleAgingRows.map((row) => ({
				estimated_applied: null,
				estimated_balance: null,
				...row,
				bucket_label: bolt.t(`reports.aging.${row.bucket}`)
			}))};
			{@const agingEntryColumns: readonly Col<(typeof agingEntryRows)[number]>[] = [
					{ field: 'reference', label: bolt.t('reports.aging.reference'), cell: agingReference },
					...(['balance', 'unapplied', 'credit', 'overpaid'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: bolt.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					})),
					...(showAgingEstimate
						? (['estimated_applied', 'estimated_balance'] as const).map((field) => ({
								field,
								kind: moneyKind,
								label: bolt.t(`reports.aging.${field}`),
								align: 'end' as const,
								cell: money
							}))
						: []),
					{ field: 'bucket_label', label: bolt.t('reports.aging.bucket'), cell: enumCell },
					{ field: 'order_number', label: bolt.t('models.orders.singular') },
					{ field: 'party_name', label: label(bolt, 'orders', 'party_name') },
					{ field: 'ledger_name', label: bolt.t('reports.aging.ledger') },
					{ field: 'currency', label: label(bolt, 'orders', 'currency') },
					{ field: 'as_of', label: bolt.t('component.aging_as_of'), cell: date },
					{ field: 'issued_on', label: bolt.t('models.transactions.fields.issued_on'), cell: date },
					{ field: 'due_on', label: label(bolt, 'orders', 'due_on'), cell: date },
					{
						field: 'settled_on',
						label: bolt.t('reports.aging.receipt_date'),
						cell: date
					}
				]}
			<Table
				layout="grid"
				of={agingEntryRows}
				key="ar_aging"
				columns={agingEntryColumns}
				toolbar={{
					new: false,
					export: true,
					description: agingScope,
					actions: [
						{
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('component.export_xlsx'),
							run: () => downloadWorkbook('ar-aging-entries', agingEntryColumns, agingEntryRows)
						}
					]
				}}
			/>
		{:else if agingAnswer?.error}<EmptyState tone="danger" title={agingAnswer.error.message} />
		{:else if agingRows}<EmptyState title={bolt.t('reports.aging.empty')} />
		{:else}<EmptyState title={bolt.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
{#snippet monthActions({ row }: { row: MonthlyCommission })}
	{#if row.latest_statement}{row.latest_number}{/if}
	{#if kinds.catalog?.commission_statements?.create && ['unacknowledged', 'changed'].includes(row.state)}<Button
			onclick={() => (monthSelection = row)}>{bolt.t('component.commission_acknowledge')}</Button
		>{/if}
{/snippet}
{#snippet monthlyCommission()}<Stack gap="md">
		{#if monthlyRows}{#await monthlyRows}<EmptyState title={bolt.t('component.reports_loading')} />
			{:then monthly}
				{@const rows = monthly.map((row) => ({
					...row,
					state_label: bolt.t(`reports.commission_ack.${row.state}`)
				}))}
				{@const commissionExport = [
					{ field: 'owner_name', label: label(bolt, 'orders', 'owner_name') },
					{ field: 'currency', label: label(bolt, 'orders', 'currency') },
					{ field: 'order_count', label: label(bolt, 'commission_statements', 'order_count') },
					{
						field: 'amount',
						label: label(bolt, 'orders', 'amount'),
						numeric: true,
						scale: 2
					},
					{
						field: 'latest_amount',
						label: bolt.t('component.commission_previous'),
						numeric: true,
						scale: 2
					},
					{ field: 'unresolved_lines', label: bolt.t('component.commission_unresolved_items') },
					{ field: 'state_label', label: label(bolt, 'orders', 'status') },
					{ field: 'latest_number', label: bolt.t('component.monthly_commission_statement') }
				]}
				<Table
					layout="grid"
					of={rows}
					key="monthly_commission"
					onOpen={(row) => {
						if (row.latest_statement) openRecord('commission_statements', row.latest_statement);
					}}
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
							field: 'latest_number',
							label: bolt.t('component.monthly_commission_statement'),
							cell: monthActions
						}
					]}
					toolbar={{
						new: false,
						export: true,
						actions: [
							{
								icon: 'lucide:file-spreadsheet',
								name: bolt.t('component.export_xlsx'),
								run: () => downloadWorkbook('commission-statements', commissionExport, rows)
							}
						]
					}}
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
			{:catch failure}<EmptyState
					tone="danger"
					title={failure instanceof Error ? failure.message : String(failure)}
				/>{/await}
		{:else if boardAnswer?.error}<EmptyState tone="danger" title={boardAnswer.error.message} />
		{:else}<EmptyState title={bolt.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
<AppShell
	description={bolt.t('app.analysis.description')}
	icon="lucide:chart-column"
	title={bolt.t('component.reports')}
	variant="full"
>
	{#snippet actions()}
		{#if tab === 'sales'}{@render salesRange()}
		{:else if tab === 'aging'}{@render agingControls()}
		{:else if tab === 'commission'}{@render commissionMonth()}
		{/if}
	{/snippet}
	{#if salesShown || agingShown || boardShown}<Tabs
			value={tab ?? undefined}
			onValueChange={(value) => (chosenTab = value)}
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
		/>{:else}<EmptyState title={bolt.t('component.reports_access')} />{/if}
</AppShell>
