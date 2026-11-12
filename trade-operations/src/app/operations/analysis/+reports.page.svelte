<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { run } from '@norbital-ai/ui/effect';
	import { marginSeries } from '../../../lib/financial-series.js';
	import {
		agingBuckets,
		readAgingReport,
		readReceivablesReport,
		agingGroup,
		agingRead,
		agingSummary,
		estimateAging,
		receivablesHeadRead,
		readSalesReport,
		salesDetail,
		salesReadDuring,
		type SalesBasis
	} from '../../../lib/reports.js';
	import { earliestReceivablesCutoff } from '../../../lib/receivables.js';
	import { xlsxWorkbook, type XlsxColumn } from '../../../lib/xlsx.js';
	import { boardRead, completeCommissionBoard, monthOf } from '../../../lib/monthly-commission.js';
	import { PlainDate, add_days, add_months } from '@norbital-ai/std/date';
	import {
		Dialog,
		Table,
		Tabs,
		Show,
		Button,
		open_record,
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
	import type { Cursor } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const costKind: Kind = { kind: 'money', currency: 'cost_currency', optional: true };
	// a cleared date means today, which rolls over at midnight
	const day = ctx.clock('day');
	const currentMonth = day.today.slice(0, 7) + '-01';
	let commissionPeriod = $state<string | null>(currentMonth);
	type MonthlyCommission = Effect.Success<ReturnType<typeof completeCommissionBoard>>[number];
	let monthSelection = $state<MonthlyCommission | null>(null);
	const monthEnd = (value: string) =>
		add_days(add_months(PlainDate(value.slice(0, 7) + '-01'), 1), -1);
	let as_of = $state<string | null>(day.today);
	let agingView = $state<'customers' | 'entries'>('customers');
	let agingBasis = $state<'estimated' | 'gross'>('estimated');
	let agingCustomer = $state<{ key: string; name: string } | null>(null);
	const pageSize = 50;
	let salesBasis = $state<SalesBasis>('invoice');
	let salesFrom = $state<string | null>(currentMonth);
	let salesTo = $state<string | null>(currentMonth);
	// each report shows to whoever reads its root: sales lines, invoices with payments, statements
	const salesShown = $derived(Boolean(ctx.catalog?.source_sales_lines));
	const agingShown = $derived(Boolean(ctx.catalog?.transactions && ctx.catalog?.source_payments));
	const boardShown = $derived(Boolean(ctx.catalog?.commission_statements));
	// the header shows the open tab's scope
	let chosenTab = $state<string | null>(null);
	const tab = $derived(
		chosenTab ?? (salesShown ? 'sales' : agingShown ? 'aging' : boardShown ? 'commission' : null)
	);
	const invalidSalesRange = $derived(Boolean(salesFrom && salesTo && salesFrom > salesTo));
	const agingDay = $derived(as_of ? PlainDate(as_of) : day.today);
	const futureAging = $derived(agingDay > day.today);
	const salesRequest = $derived(
		salesShown && tab === 'sales' && !invalidSalesRange
			? salesReadDuring(
					{
						basis: salesBasis,
						from: salesFrom ? PlainDate(salesFrom) : null,
						to: salesTo ? PlainDate(monthEnd(salesTo)) : null
					},
					ctx.catalog?.source_sales_lines?.output === 'commercial',
					pageSize
				)
			: null
	);
	let salesNavigation = $state.raw<{
		request: NonNullable<typeof salesRequest>;
		cursors: Cursor[];
	} | null>(null);
	const salesCursors = $derived(
		salesNavigation && salesNavigation.request === salesRequest ? salesNavigation.cursors : []
	);
	const salesAfter = $derived(salesCursors.at(-1));
	const salesPageRequest = $derived.by(() => {
		if (!salesRequest) return null;
		const { products: _, ...request } = salesRequest;
		return request;
	});
	const liveSales = $derived(salesPageRequest && !salesAfter ? ctx.query(salesPageRequest) : null);
	type SalesPage = NonNullable<NonNullable<typeof liveSales>['current']>;
	let laterSales = $state.raw<SalesPage | null>(null);
	let salesPageError = $state(false);
	$effect(() => {
		const request = salesPageRequest;
		const after = salesAfter;
		laterSales = null;
		salesPageError = false;
		if (!request || !after) return;
		let current = true;
		// Cursor pages are one-shot reads. The first page can stay subscribed to source changes.
		void run(
			ctx.query({ ...request, source_sales_lines: { ...request.source_sales_lines, after } })
		).then(
			(page) => {
				if (current) laterSales = page;
			},
			() => {
				if (current) salesPageError = true;
			}
		);
		return () => {
			current = false;
		};
	});
	const salesPageAnswer = $derived(salesAfter ? laterSales : (liveSales?.current ?? null));
	const detailRows = $derived(
		salesPageAnswer ? salesDetail(salesPageAnswer, { basis: salesBasis }) : null
	);
	function salesPage(next: Cursor | null) {
		if (salesRequest)
			salesNavigation = {
				request: salesRequest,
				cursors: next ? [...salesCursors, next] : salesCursors.slice(0, -1)
			};
	}
	const fullSales = Effect.fnUntraced(function* (
		request: NonNullable<typeof salesRequest>,
		basis: SalesBasis
	) {
		const batch = { ...request, source_sales_lines: { ...request.source_sales_lines, limit: 500 } };
		return yield* readSalesReport(ctx, batch, yield* ctx.query(batch), basis);
	});
	let marginRequest = $state.raw<{
		request: NonNullable<typeof salesRequest>;
		result: Promise<ReturnType<typeof marginSeries>>;
	} | null>(null);
	const margins = $derived(
		marginRequest && marginRequest.request === salesRequest ? marginRequest.result : null
	);
	function toggleMargins() {
		if (!salesRequest) return;
		marginRequest = margins
			? null
			: {
					request: salesRequest,
					result: run(fullSales(salesRequest, salesBasis).pipe(Effect.map(marginSeries)))
				};
	}
	let exporting = $state(false);
	let salesExportError = $state(false);
	const agingSources = $derived(
		tab === 'aging' && agingShown && ctx.catalog?.source_receivables
			? ctx.query(receivablesHeadRead)
			: null
	);
	let snapshotTail = $state.raw<Effect.Success<ReturnType<typeof readReceivablesReport>> | null>(
		null
	);
	let snapshotError = $state(false);
	$effect(() => {
		const first = agingSources?.current;
		snapshotTail = null;
		snapshotError = false;
		if (!first) return;
		if (first.source_receivables.total === 0) {
			snapshotTail = [];
			return;
		}
		let current = true;
		void run(readReceivablesReport(ctx)).then(
			(rows) => {
				if (current) snapshotTail = rows;
			},
			() => {
				if (current) snapshotError = true;
			}
		);
		return () => {
			current = false;
		};
	});
	const snapshots = $derived(snapshotTail ?? []);
	const showAgingEstimate = $derived(snapshots.length > 0 && agingBasis === 'estimated');
	const coveredLedgers = $derived(snapshots.flatMap((snapshot) => snapshot.source?.id ?? []));
	const earlyAging = $derived(snapshots.length > 0 && agingDay < earliestReceivablesCutoff);
	const agingRequest = $derived(
		tab === 'aging' &&
			agingShown &&
			!futureAging &&
			!earlyAging &&
			(!agingSources || snapshotTail !== null)
			? agingRead(agingDay, coveredLedgers, 500)
			: null
	);
	const agingAnswer = $derived(agingRequest ? ctx.query(agingRequest) : null);
	const agingScope = $derived(
		ctx.t(
			showAgingEstimate
				? 'reports.aging.estimate_scope'
				: snapshots.length
					? 'reports.aging.account_scope'
					: 'reports.aging.cutoff_scope'
		)
	);
	let agingFacts = $state.raw<Effect.Success<ReturnType<typeof readAgingReport>> | null>(null);
	let agingIncomplete = $state(false);
	$effect(() => {
		const first = agingAnswer?.current;
		const request = agingRequest;
		agingFacts = null;
		agingIncomplete = false;
		if (!request || !first) return;
		let current = true;
		void run(readAgingReport(ctx, request, first, agingDay, snapshots)).then(
			(rows) => {
				if (current) agingFacts = rows;
			},
			() => {
				if (current) agingIncomplete = true;
			}
		);
		return () => {
			current = false;
		};
	});
	const agingRows = $derived(
		agingFacts && showAgingEstimate ? estimateAging(agingFacts) : agingFacts
	);
	const agingCustomers = $derived(agingRows ? agingSummary(agingRows) : null);
	const visibleAgingRows = $derived(
		agingRows?.filter((row) => !agingCustomer || agingGroup(row) === agingCustomer.key)
	);
	const period = $derived(commissionPeriod ? monthOf(commissionPeriod) : null);
	const boardRequest = $derived(
		tab === 'commission' && boardShown && period
			? boardRead(period, ctx.catalog?.source_sales_lines?.output === 'commercial')
			: null
	);
	const boardAnswer = $derived(boardRequest ? ctx.query(boardRequest) : null);
	const monthlyRows = $derived(
		boardRequest && boardAnswer?.current && period
			? run(completeCommissionBoard(ctx, boardRequest, boardAnswer.current, period))
			: null
	);
	const shapeSalesRows = (rows: ReturnType<typeof salesDetail>) =>
		rows.map((row) => ({
			...row,
			freight_treatment_label: row.freight_treatment
				? ctx.t(`reports.freight.${row.freight_treatment}`)
				: '',
			kind_label: ctx.t(`reports.sales.kind.${row.kind}`)
		}));
	let reportPages = $state({ customers: 0, entries: 0, commission: 0 });
	const pageIndex = (kind: keyof typeof reportPages, total: number) =>
		Math.min(reportPages[kind], Math.max(0, Math.ceil(total / pageSize) - 1));
	$effect.pre(() => {
		void as_of;
		void agingView;
		void agingBasis;
		void agingCustomer;
		reportPages.customers = 0;
		reportPages.entries = 0;
	});
	$effect.pre(() => {
		void commissionPeriod;
		reportPages.commission = 0;
	});
	const visiblePage = <A,>(kind: keyof typeof reportPages, rows: readonly A[]) => {
		const start = pageIndex(kind, rows.length) * pageSize;
		return rows.slice(start, start + pageSize);
	};
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
			aria-label={ctx.t('reports.sales.date_basis')}
			bind:value={salesBasis}
			class="h-9 rounded-md border border-input bg-background px-2 text-sm"
		>
			<option value="invoice">{ctx.t('reports.sales.date_invoice')}</option>
			<option value="delivery">{ctx.t('reports.sales.date_delivery')}</option>
		</select>
		<span class="sr-only">{ctx.t('component.sales_analysis')}</span><TimeRangeInput
			id="sales-range"
			of="date"
			precision="month"
			value={{ from: salesFrom, to: salesTo }}
			on_change={(range) => {
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
		><span class="sr-only">{ctx.t('models.commission_statements.fields.period')}</span><TimeInput
			id="commission-month"
			of="date"
			precision="month"
			value={commissionPeriod}
			on_change={(value: string | null) =>
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
			onclick={() => open_record('orders', order)}
		>
			{row.order_number}
		</button>
	{/if}
{/snippet}
{#snippet salesTab()}<Stack size="fill" min_height="18rem" gap="sm">
		{#if invalidSalesRange}<EmptyState tone="danger" title={ctx.t('errors.report_range')} />
		{:else if salesPageError || liveSales?.error}<EmptyState
				tone="danger"
				title={ctx.t('reports.sales.incomplete')}
			/>
			{#if salesAfter}<Button variant="outline" onclick={() => (salesNavigation = null)}
					>{ctx.t('reports.first_page')}</Button
				>{/if}
		{:else if detailRows}
			{@const rows = shapeSalesRows(detailRows)}
			{#if margins}
				{#await margins}<p class="text-sm text-muted-foreground" role="status">
						{ctx.t('component.reports_loading')}
					</p>
				{:then summary}
					{@const known = summary.filter((row) => row.margin !== null)}
					{#each [...new Set(known.map((row) => row.currency))] as currency}
						<Chart
							of={known.filter((row) => row.currency === currency)}
							x="salesperson"
							y="margin"
							orientation="horizontal"
							title={`${ctx.t('component.actual_margins')} · ${currency}`}
						/>
					{:else}<p class="text-sm text-muted-foreground">
							{ctx.t('component.unpriced_margin')}
						</p>{/each}
				{:catch}<p class="text-sm text-destructive" role="alert">
						{ctx.t('reports.sales.incomplete')}
					</p>{/await}
			{/if}
			{#if salesExportError}<p class="text-sm text-destructive" role="alert">
					{ctx.t('reports.sales.incomplete')}
				</p>{/if}
			{#if exporting}<p class="text-sm text-muted-foreground" role="status">
					{ctx.t('reports.exporting')}
				</p>{/if}
			{@const hasCost = ctx.catalog?.source_sales_lines?.output !== 'commercial'}
			{@const separateCostCurrency = hasCost}
			{@const salesColumns: readonly Col<(typeof rows)[number]>[] = [
					{ field: 'order_number', label: ctx.t('models.orders.singular'), cell: salesOrderCell },
					{ field: 'reference', label: ctx.t('reports.sales.reference') },
					{
						field: 'business_on',
						label: ctx.t(
							salesBasis === 'invoice'
								? 'reports.sales.date_invoice'
								: 'reports.sales.date_delivery'
						),
						cell: date
					},
					{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
					{ field: 'product_name', label: ctx.t('reports.sales.product') },
					{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
					{ field: 'kind_label', label: ctx.t('reports.sales.kind'), cell: enumCell },
					{
						field: 'quantity',
						kind: { kind: 'decimal', scale: 3 },
						label: label(ctx, 'orders', 'quantity'),
						align: 'end' as const,
						cell: decimal
					},
					{ field: 'unit', label: ctx.t('reports.sales.unit') },
					{ field: 'lot_number', label: ctx.t('models.stock_snapshots.fields.lot_number') },
					{ field: 'currency', label: label(ctx, 'orders', 'currency') },
					{ field: 'freight_treatment_label', label: ctx.t('reports.sales.freight_treatment') },
					...(['sold_price', 'floor_net'] as const).map((field) => ({
						field,
						kind: { kind: 'decimal' as const, scale: 8 },
						label: ctx.t(`reports.sales.${field}`),
						align: 'end' as const,
						cell: decimal
					})),
					...(['source_net', 'net', 'tax', 'total', 'freight'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: ctx.t(`reports.sales.${field}`),
						align: 'end' as const,
						cell: money
					})),
					...(hasCost
						? [
								{
									field: 'cost' as const,
									kind: costKind,
									label: ctx.t('reports.sales.cost'),
									align: 'end' as const,
									cell: deliveryCost
								}
							]
						: []),
					...(separateCostCurrency
						? [{ field: 'cost_currency' as const, label: ctx.t('reports.sales.cost_currency') }]
						: []),
					{
						field: 'margin',
						kind: moneyKind,
						label: ctx.t('reports.sales.margin'),
						align: 'end',
						cell: money
					}
				]}
			<Table
				layout="grid"
				of={rows}
				controlled
				key="sales_detail"
				columns={salesColumns.filter(
					(column) =>
						typeof column === 'string' ||
						![
							'kind_label',
							'freight_treatment_label',
							'floor_net',
							'freight',
							'cost_currency'
						].includes(column.field)
				)}
				toolbar={{
					new: false,
					search: false,
					filter: false,
					description: ctx.t('component.unpriced_margin'),
					actions: [
						{
							icon: 'lucide:chart-column',
							name: ctx.t('component.actual_margins'),
							run: toggleMargins
						},
						{
							icon: 'lucide:file-spreadsheet',
							name: ctx.t('component.export_xlsx'),
							run: () => {
								if (!salesRequest || exporting) return;
								exporting = true;
								salesExportError = false;
								void run(fullSales(salesRequest, salesBasis))
									.then(
										(all) => downloadWorkbook('sales-analysis', salesColumns, shapeSalesRows(all)),
										() => {
											salesExportError = true;
										}
									)
									.finally(() => {
										exporting = false;
									});
							}
						}
					]
				}}
			>
				{#snippet footer()}
					{@render pager(
						salesCursors.length,
						salesPageAnswer?.source_sales_lines.next != null,
						(direction) =>
							salesPage(direction < 0 ? null : (salesPageAnswer?.source_sales_lines.next ?? null))
					)}
				{/snippet}
				{#snippet empty()}<EmptyState
						title={ctx.t(
							salesBasis === 'invoice' ? 'reports.sales.no_invoices' : 'reports.sales.no_deliveries'
						)}
					/>{/snippet}
			</Table>
		{:else}<EmptyState title={ctx.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
{#snippet pager(index: number, next: boolean, move: (direction: number) => void)}
	<div
		class="flex flex-wrap items-center justify-end gap-2"
		aria-label={ctx.t('reports.page_navigation')}
	>
		<span class="text-sm tabular-nums text-muted-foreground"
			>{ctx.t('reports.page_number', { page: index + 1 })}</span
		>
		<Button variant="outline" disabled={index === 0} onclick={() => move(-1)}
			>{ctx.t('reports.previous')}</Button
		>
		<Button variant="outline" disabled={!next} onclick={() => move(1)}
			>{ctx.t('reports.next')}</Button
		>
	</div>
{/snippet}
{#snippet localPager(kind: keyof typeof reportPages, total: number)}
	{@const index = pageIndex(kind, total)}
	{@render pager(
		index,
		(index + 1) * pageSize < total,
		(direction) => (reportPages[kind] = index + direction)
	)}
{/snippet}
{#snippet agingReference({
	row
}: {
	row: Effect.Success<ReturnType<typeof readAgingReport>>[number];
})}
	{#if row.invoice || row.order}
		<button
			type="button"
			class="underline-offset-4 hover:underline focus-visible:underline"
			onclick={() => {
				if (row.invoice) open_record('transactions', row.invoice);
				else if (row.order) open_record('orders', row.order);
			}}>{row.reference}</button
		>
	{:else}{row.reference}{/if}
{/snippet}
{#snippet agingControls()}<div class="flex max-w-full flex-wrap items-end gap-2">
		<label class="flex w-44 flex-col gap-1 text-sm" for="ar-aging-date">
			{ctx.t('component.aging_as_of')}
			<TimeInput
				id="ar-aging-date"
				value={as_of}
				on_change={(value: string | null) => (as_of = value)}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{ctx.t('reports.aging.view')}
			<select
				bind:value={agingView}
				onchange={() => (agingCustomer = null)}
				class="h-9 rounded-md border border-input bg-background px-2"
			>
				<option value="customers">{ctx.t('reports.aging.customers')}</option>
				<option value="entries">{ctx.t('reports.aging.entries')}</option>
			</select>
		</label>
		{#if snapshots.length}
			<label class="flex flex-col gap-1 text-sm">
				{ctx.t('reports.aging.basis')}
				<select
					bind:value={agingBasis}
					class="h-9 rounded-md border border-input bg-background px-2"
				>
					<option value="estimated">{ctx.t('reports.aging.basis_estimated')}</option>
					<option value="gross">{ctx.t('reports.aging.basis_gross')}</option>
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
				{ctx.t('reports.aging.all_customers')}
			</Button>
		{/if}
	</div>
{/snippet}
{#snippet customersPager()}{@render localPager('customers', agingCustomers?.length ?? 0)}{/snippet}
{#snippet entriesPager()}{@render localPager('entries', visibleAgingRows?.length ?? 0)}{/snippet}
{#snippet aging()}<Stack size="fill" min_height="18rem" gap="sm">
		{#each snapshots as snapshot (snapshot.id)}
			<p class="text-sm text-muted-foreground">
				{snapshot.source?.name} · {ctx.t('reports.aging.snapshot_at')}
				<Show kind={{ kind: 'instant' }} value={snapshot.observed_at} />
			</p>
		{/each}
		{#if agingCustomer}<p class="text-sm font-medium">{agingCustomer.name}</p>{/if}
		{#if futureAging}<EmptyState tone="danger" title={ctx.t('errors.report_future')} />
		{:else if earlyAging}<EmptyState tone="danger" title={ctx.t('reports.aging.early_cutoff')} />
		{:else if agingSources?.error}<EmptyState tone="danger" title={agingSources.error.message} />
		{:else if agingIncomplete || snapshotError}<EmptyState
				tone="danger"
				title={ctx.t('reports.aging.incomplete')}
			/>
		{:else if agingView === 'customers' && agingCustomers?.length}
			{@const agingCustomerColumns: readonly Col<NonNullable<typeof agingCustomers>[number]>[] = [
					{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
					...(['net', 'balance', 'unapplied', 'credit', 'overpaid'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: ctx.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					})),
					{ field: 'ledger_name', label: ctx.t('reports.aging.ledger') },
					{ field: 'currency', label: label(ctx, 'orders', 'currency') },
					{ field: 'as_of', label: ctx.t('component.aging_as_of'), cell: date },
					...(showAgingEstimate
						? [
								{
									field: 'estimated_balance' as const,
									kind: moneyKind,
									label: ctx.t('reports.aging.estimated_balance'),
									align: 'end' as const,
									cell: money
								}
							]
						: []),
					...agingBuckets.map((field) => ({
						field,
						kind: moneyKind,
						label: ctx.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					}))
				]}
			<Table
				layout="grid"
				of={visiblePage('customers', agingCustomers)}
				controlled
				footer={customersPager}
				key="ar_customers"
				on_open={(row) => {
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
							name: ctx.t('component.export_xlsx'),
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
				bucket_label: ctx.t(`reports.aging.${row.bucket}`)
			}))};
			{@const agingEntryColumns: readonly Col<(typeof agingEntryRows)[number]>[] = [
					{ field: 'reference', label: ctx.t('reports.aging.reference'), cell: agingReference },
					...(['balance', 'unapplied', 'credit', 'overpaid'] as const).map((field) => ({
						field,
						kind: moneyKind,
						label: ctx.t(`reports.aging.${field}`),
						align: 'end' as const,
						cell: money
					})),
					...(showAgingEstimate
						? (['estimated_applied', 'estimated_balance'] as const).map((field) => ({
								field,
								kind: moneyKind,
								label: ctx.t(`reports.aging.${field}`),
								align: 'end' as const,
								cell: money
							}))
						: []),
					{ field: 'bucket_label', label: ctx.t('reports.aging.bucket'), cell: enumCell },
					{ field: 'order_number', label: ctx.t('models.orders.singular') },
					{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
					{ field: 'ledger_name', label: ctx.t('reports.aging.ledger') },
					{ field: 'currency', label: label(ctx, 'orders', 'currency') },
					{ field: 'as_of', label: ctx.t('component.aging_as_of'), cell: date },
					{ field: 'issued_on', label: ctx.t('models.transactions.fields.issued_on'), cell: date },
					{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), cell: date },
					{
						field: 'settled_on',
						label: ctx.t('reports.aging.receipt_date'),
						cell: date
					}
				]}
			<Table
				layout="grid"
				of={visiblePage('entries', agingEntryRows)}
				controlled
				footer={entriesPager}
				key="ar_aging"
				columns={agingEntryColumns}
				toolbar={{
					new: false,
					export: true,
					description: agingScope,
					actions: [
						{
							icon: 'lucide:file-spreadsheet',
							name: ctx.t('component.export_xlsx'),
							run: () => downloadWorkbook('ar-aging-entries', agingEntryColumns, agingEntryRows)
						}
					]
				}}
			/>
		{:else if agingAnswer?.error}<EmptyState tone="danger" title={agingAnswer.error.message} />
		{:else if agingRows}<EmptyState title={ctx.t('reports.aging.empty')} />
		{:else}<EmptyState title={ctx.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
{#snippet monthActions({ row }: { row: MonthlyCommission })}
	{#if row.latest_statement}{row.latest_number}{/if}
	{#if ctx.catalog?.commission_statements?.create && ['unacknowledged', 'changed'].includes(row.state)}<Button
			onclick={() => (monthSelection = row)}>{ctx.t('component.commission_acknowledge')}</Button
		>{/if}
{/snippet}
{#snippet monthlyCommission()}<Stack size="fill" min_height="18rem" gap="sm">
		{#if monthlyRows}{#await monthlyRows}<EmptyState title={ctx.t('component.reports_loading')} />
			{:then monthly}
				{@const rows = monthly.map((row) => ({
					...row,
					state_label: ctx.t(`reports.commission_ack.${row.state}`)
				}))}
				{#snippet commissionPager()}{@render localPager('commission', rows.length)}{/snippet}
				{@const commissionExport = [
					{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
					{ field: 'currency', label: label(ctx, 'orders', 'currency') },
					{ field: 'order_count', label: label(ctx, 'commission_statements', 'order_count') },
					{
						field: 'amount',
						label: label(ctx, 'orders', 'amount'),
						numeric: true,
						scale: 2
					},
					{
						field: 'latest_amount',
						label: ctx.t('component.commission_previous'),
						numeric: true,
						scale: 2
					},
					{ field: 'unresolved_lines', label: ctx.t('component.commission_unresolved_items') },
					{ field: 'state_label', label: label(ctx, 'orders', 'status') },
					{ field: 'latest_number', label: ctx.t('component.monthly_commission_statement') }
				]}
				<Table
					layout="grid"
					of={visiblePage('commission', rows)}
					controlled
					footer={commissionPager}
					key="monthly_commission"
					on_open={(row) => {
						if (row.latest_statement) open_record('commission_statements', row.latest_statement);
					}}
					columns={[
						{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
						{ field: 'currency', label: label(ctx, 'orders', 'currency') },
						{ field: 'order_count', label: label(ctx, 'commission_statements', 'order_count') },
						{
							field: 'amount',
							kind: moneyKind,
							label: label(ctx, 'orders', 'amount'),
							align: 'end' as const,
							cell: money
						},
						{
							field: 'latest_amount',
							kind: moneyKind,
							label: ctx.t('component.commission_previous'),
							align: 'end' as const,
							cell: money
						},
						{ field: 'unresolved_lines', label: ctx.t('component.commission_unresolved_items') },

						{ field: 'state_label', label: label(ctx, 'orders', 'status'), cell: enumCell },
						{
							field: 'latest_number',
							label: ctx.t('component.monthly_commission_statement'),
							cell: monthActions
						}
					]}
					toolbar={{
						new: false,
						export: true,
						actions: [
							{
								icon: 'lucide:file-spreadsheet',
								name: ctx.t('component.export_xlsx'),
								run: () => downloadWorkbook('commission-statements', commissionExport, rows)
							}
						]
					}}
				/>
				{#if monthSelection && rows.some((row) => row.calculation_hash === monthSelection?.calculation_hash && ['unacknowledged', 'changed'].includes(row.state))}
					<Dialog.Root
						open={monthSelection !== null}
						on_open_change={(open) => {
							if (!open) monthSelection = null;
						}}
						><Dialog.Content
							><Dialog.Title>{ctx.t('component.monthly_commission_statement')}</Dialog.Title>
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
								submit={ctx.t('component.commission_acknowledge')}
								on_outcome={() => (monthSelection = null)}
							/>
						</Dialog.Content></Dialog.Root
					>
				{/if}
			{:catch failure}<EmptyState
					tone="danger"
					title={failure instanceof Error ? failure.message : String(failure)}
				/>{/await}
		{:else if boardAnswer?.error}<EmptyState tone="danger" title={boardAnswer.error.message} />
		{:else}<EmptyState title={ctx.t('component.reports_loading')} />{/if}
	</Stack>{/snippet}
<AppShell
	description={ctx.t('app.analysis.description')}
	icon="lucide:chart-column"
	title={ctx.t('component.reports')}
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
			on_value_change={(value) => (chosenTab = value)}
			tabs={[
				...(salesShown
					? [{ name: 'sales', title: ctx.t('component.sales_analysis'), body: salesTab }]
					: []),
				...(agingShown ? [{ name: 'aging', title: ctx.t('component.ar_aging'), body: aging }] : []),
				...(boardShown
					? [{ name: 'commission', title: ctx.t('component.commission'), body: monthlyCommission }]
					: [])
			]}
		/>{:else}<EmptyState title={ctx.t('component.reports_access')} />{/if}
</AppShell>
