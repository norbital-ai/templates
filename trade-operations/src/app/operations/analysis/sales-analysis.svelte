<script lang="ts">
	// Sales analysis: every sold line in the period, read left to right as the goods and the money moved — its lot,
	// its order, the delivery or invoice it is, how it was billed and collected, and the margin it left.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal } from 'effect';
	import {
		Badge,
		Chart,
		EmptyState,
		Show,
		Table,
		TableSkeleton,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Bound, Grid, Stack } from '@norbital-ai/ui/layout';
	import { marginSeries } from '../../../lib/financial-series.js';
	import {
		purchaseChain,
		purchaseChainRead,
		salesCollection,
		salesCollectionRead,
		salesDetail,
		salesReadDuring,
		type SalesBasis
	} from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';
	import { displayUnit, priceToDisplay, qtyToDisplay } from '../../../lib/unit-display.js';

	let {
		ctx,
		basis,
		from,
		to
	}: { ctx: PageContext; basis: SalesBasis; from: string | null; to: string | null } = $props();
	const day = ctx.clock('day');
	const commercial = $derived(ctx.catalog?.source_sales_lines?.output === 'commercial');
	// the period in one read of up to 10,000 lines, alongside product categories and party classifications
	const facts = $derived.by(() => {
		const request = salesReadDuring({ basis, from, to }, commercial);
		return ctx.query({
			...request,
			products: { ...request.products, limit: 10_000 },
			parties: { fields: ['source', 'external_code', 'region', 'related_party'], limit: 10_000 }
		});
	});
	const detail = $derived(facts.current ? salesDetail(facts.current, { basis }) : null);
	const orders = $derived([...new Set(detail?.flatMap((row) => row.order ?? []))]);
	// what each line was billed and collected: its orders' invoices and their payments, in a second read
	const billing = $derived(
		orders.length > 0 && ctx.catalog?.transactions && ctx.catalog?.source_payments
			? ctx.query(salesCollectionRead(orders))
			: null
	);
	// where each sold lot came from: its receipts and purchase invoices, in a read beside the billing one
	const lots = $derived([...new Set(detail?.flatMap((row) => row.lot_number ?? []))]);
	const purchases = $derived(
		lots.length > 0 && ctx.catalog?.source_purchase_lines
			? ctx.query(purchaseChainRead(lots))
			: null
	);
	const purchased = $derived(Boolean(ctx.catalog?.source_purchase_lines));
	const rows = $derived.by(() => {
		if (!detail || (billing && !billing.current) || (purchases && !purchases.current)) return null;
		const chained = billing?.current
			? salesCollection(detail, billing.current)
			: detail.map((row) => ({
					...row,
					invoice_numbers: '',
					invoiced_on: null,
					due_on: null,
					collection: null,
					collected_on: null
				}));
		return purchaseChain(chained, purchases?.current?.source_purchase_lines.rows ?? []).map(
			(row) => ({
				...row,
				quantity: qtyToDisplay(row.quantity, row.unit) ?? row.quantity,
				unit: displayUnit(row.unit, ctx.locale) || row.unit,
				sold_price: priceToDisplay(row.sold_price, row.unit),
				purchase_price: priceToDisplay(row.purchase_price ?? row.lot_unit_cost, row.unit),
				purchase_price_currency:
					row.purchase_price !== null
						? row.purchase_price_currency
						: row.lot_unit_cost !== null
							? (row.cost_currency ?? row.currency)
							: null,
				supplier_payment_label: row.supplier_payment
					? ctx.t(`reports.sales.supplier_payment.${row.supplier_payment}`)
					: '',
				kind_label: ctx.t(`reports.sales.kind.${row.kind}`),
				party_relation: ctx.t(
					row.related_party ? 'reports.party.related' : 'reports.party.third_party'
				),
				collection_label: row.collection ? ctx.t(`reports.sales.collection.${row.collection}`) : ''
			})
		);
	});
	const truncated = $derived(Boolean(facts.current?.source_sales_lines.next));
	const hasCost = $derived(!commercial);
	// each currency's totals; cost and margin count in the cost's currency, and only the lines whose cost is known
	const totals = $derived.by(() => {
		const all = rows ?? [];
		const sum = (values: readonly (string | null)[]) =>
			BigDecimal.sumAll(
				values.flatMap((value) => (value === null ? [] : [BigDecimal.fromStringUnsafe(value)]))
			);
		const figure = (
			field: 'net' | 'tax' | 'freight' | 'cost' | 'margin',
			value: BigDecimal.BigDecimal
		) => ({
			field,
			value: BigDecimal.format(value)
		});
		const marginIn = (line: (typeof all)[number]) => line.cost_currency ?? line.currency;
		const currencies = new Set(
			all.flatMap((line) => [line.currency, ...(line.margin === null ? [] : [marginIn(line)])])
		);
		return [...currencies].map((currency) => {
			const lines = all.filter((line) => line.currency === currency);
			const priced = all.filter((line) => line.margin !== null && marginIn(line) === currency);
			const cost = sum(priced.map((line) => line.cost));
			const margin = sum(priced.map((line) => line.margin));
			// the net the margin was taken from, in the cost's currency
			const costedNet = BigDecimal.sum(cost, margin);
			const netTotal = sum(lines.map((line) => line.net));
			const taxTotal = sum(lines.map((line) => line.tax));
			// Cap summary strip at 5 KPIs (lines + net + non-zero tax + margin + margin_rate)
			return {
				currency,
				lines: lines.length,
				figures: [
					...(lines.length
						? [
								figure('net', netTotal),
								...(!BigDecimal.isZero(taxTotal) ? [figure('tax', taxTotal)] : [])
							]
						: []),
					...(hasCost && priced.length ? [figure('margin', margin)] : [])
				],
				margin_rate:
					hasCost && priced.length && BigDecimal.isPositive(costedNet)
						? BigDecimal.format(
								BigDecimal.round(
									BigDecimal.divideUnsafe(
										BigDecimal.multiply(margin, BigDecimal.fromBigInt(100n)),
										costedNet
									),
									{ scale: 1 }
								)
							)
						: null
			};
		});
	});
	let chart = $state(false);
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const costKind: Kind = { kind: 'money', currency: 'cost_currency', optional: true };
	const dateKind: Kind = { kind: 'date', optional: true };
</script>

{#snippet badge({ value }: { value: ShowProps['value'] })}{#if value}<Badge variant="outline"
			>{String(value)}</Badge
		>{/if}{/snippet}

<Stack size="fill" min_height="18rem" gap="sm">
	{#if facts.error || billing?.error || purchases?.error}
		<EmptyState tone="danger" title={ctx.t('reports.sales.incomplete')} />
	{:else if rows}
		{#each totals as total (total.currency)}
			<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
				{#if total.lines > 0}
					<div>
						<dt class="text-meta">{ctx.t('reports.sales.lines')}</dt>
						<dd class="text-heading tabular-nums">{total.lines}</dd>
					</div>
				{/if}
				{#each total.figures as figure (figure.field)}
					<div>
						<dt class="text-meta">{ctx.t(`reports.sales.${figure.field}`)}</dt>
						<dd class="text-heading tabular-nums">
							<Show {ctx} kind={moneyKind} value={figure.value} row={total} />
						</dd>
					</div>
				{/each}
				{#if total.margin_rate !== null}
					<div>
						<dt class="text-meta">{ctx.t('reports.sales.margin_rate')}</dt>
						<dd class="text-heading tabular-nums">{total.margin_rate}%</dd>
					</div>
				{/if}
			</Grid>
		{/each}
		{#if chart}
			{@const series = marginSeries(rows).filter((row) => row.margin !== null)}
			{@const currencies = [...new Set(series.map((row) => row.currency))]}
			{#if currencies.length > 0}
				<Grid minimum="panel" gap="sm">
					{#each currencies as currency (currency)}
						<Bound height="18rem">
							<Chart
								{ctx}
								of={series.filter((row) => row.currency === currency)}
								x="salesperson"
								y="margin"
								orientation="horizontal"
								title={`${ctx.t('component.actual_margins')} · ${currency}`}
							/>
						</Bound>
					{/each}
				</Grid>
			{:else}
				<p class="text-sm text-muted-foreground">
					{ctx.t('component.unpriced_margin')}
				</p>
			{/if}
		{/if}
		{@const columns: readonly Col<(typeof rows)[number]>[] = [
			...(purchased
				? [
						{ field: 'order_reference' as const, label: ctx.t('reports.sales.order_reference') },
						{ field: 'supplier' as const, label: ctx.t('reports.sales.supplier') }
					]
				: []),
			...(hasCost
				? [
						{
							field: 'purchase_price' as const,
							label: ctx.t('reports.sales.purchase_price'),
							kind: {
								kind: 'money',
								currency: 'purchase_price_currency',
								scale: 4,
								optional: true
							} as const,
							align: 'end' as const
						}
					]
				: []),
			...(purchased
				? [
						{ field: 'purchase_invoices' as const, label: ctx.t('reports.sales.purchase_invoices') },
						{
							field: 'purchase_invoiced_on' as const,
							label: ctx.t('reports.sales.purchase_invoiced_on'),
							kind: dateKind
						},
						{
							field: 'supplier_payment_label' as const,
							label: ctx.t('reports.sales.supplier_payment'),
							cell: badge
						},
						{ field: 'supplier_paid_on' as const, label: ctx.t('reports.sales.supplier_paid_on'), kind: dateKind }
					]
				: []),
			{ field: 'lot_number', label: ctx.t('models.stock_snapshots.fields.lot_number') },
			...(purchased
				? [{ field: 'first_received_on' as const, label: ctx.t('reports.sales.first_received_on'), kind: dateKind }]
				: []),
			{ field: 'order_number', label: ctx.t('models.orders.singular') },
			{ field: 'ordered_on', label: label(ctx, 'orders', 'ordered_on'), kind: dateKind },
			{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
			{ field: 'party_region', label: ctx.t('models.parties.fields.region') },
			{ field: 'party_relation', label: ctx.t('reports.party.relation'), cell: badge },
			{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
			{ field: 'kind_label', label: ctx.t('reports.sales.kind'), cell: badge },
			{ field: 'reference', label: ctx.t('reports.sales.reference') },
			{
				field: 'business_on',
				label: ctx.t(basis === 'invoice' ? 'reports.sales.date_invoice' : 'reports.sales.date_delivery'),
				kind: { kind: 'date' }
			},
			{ field: 'product_category', label: ctx.t('models.products.fields.category') },
			{ field: 'product_name', label: ctx.t('reports.sales.product') },
			{
				field: 'quantity',
				label: label(ctx, 'orders', 'quantity'),
				kind: { kind: 'decimal', scale: 3 },
				align: 'end'
			},
			{ field: 'unit', label: ctx.t('reports.sales.unit') },
			{
				field: 'sold_price',
				label: ctx.t('reports.sales.sold_price'),
				kind: { kind: 'money', currency: 'currency', scale: 4, optional: true },
				align: 'end'
			},
			{ field: 'invoice_numbers', label: ctx.t('reports.sales.invoice_numbers') },
			...(basis === 'invoice'
				? []
				: [{ field: 'invoiced_on' as const, label: ctx.t('reports.sales.date_invoice'), kind: dateKind }]),
			{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), kind: dateKind },
			{ field: 'collection_label', label: ctx.t('reports.sales.collection'), cell: badge },
			{ field: 'collected_on', label: ctx.t('reports.sales.collected_on'), kind: dateKind },
			...(['net', 'tax', 'freight'] as const).map((field) => ({
				field,
				label: ctx.t(`reports.sales.${field}`),
				kind: moneyKind,
				align: 'end' as const
			})),
			...(hasCost
				? [
						...(['cost', 'margin'] as const).map((field) => ({
							field,
							label: ctx.t(`reports.sales.${field}`),
							kind: costKind,
							align: 'end' as const
						})),
						{
							field: 'margin_rate' as const,
							label: ctx.t('reports.sales.margin_rate'),
							kind: { kind: 'decimal', scale: 1, optional: true } as const,
							align: 'end' as const
						}
					]
				: [])
		]}
		<Table
			{ctx}
			layout="grid"
			of={rows}
			key="sales_analysis"
			{columns}
			on_open={(row) => {
				if (row.order) open_record('orders', row.order);
			}}
			toolbar={{
				// a period past one read says so in the title, where it shifts nothing
				title: truncated
					? `${ctx.t('component.sales_analysis')} · ${ctx.t('reports.sales.truncated')}`
					: ctx.t('component.sales_analysis'),
				description: ctx.t('component.unpriced_margin'),
				new: false,
				actions:
					rows.length > 0
						? [
								{
									icon: 'lucide:chart-column',
									name: ctx.t('component.actual_margins'),
									run: () => {
										chart = !chart;
									}
								},
								{
									icon: 'lucide:file-spreadsheet',
									name: ctx.t('component.export_xlsx'),
									run: () => downloadXlsx('sales-analysis', day.today, columns, rows)
								}
							]
						: []
			}}
		>
			{#snippet empty()}<EmptyState
					title={ctx.t(
						basis === 'invoice' ? 'reports.sales.no_invoices' : 'reports.sales.no_deliveries'
					)}
				/>{/snippet}
		</Table>
	{:else}
		<div aria-busy="true" aria-label={ctx.t('component.reports_loading')}><TableSkeleton /></div>
	{/if}
</Stack>
