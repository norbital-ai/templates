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
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
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

	let {
		ctx,
		basis,
		from,
		to
	}: { ctx: PageContext; basis: SalesBasis; from: string | null; to: string | null } = $props();
	const day = ctx.clock('day');
	const commercial = $derived(ctx.catalog?.source_sales_lines?.output === 'commercial');
	// the period in one read of up to 10,000 lines, without the product catalogue the lines already name
	const facts = $derived.by(() => {
		const { products: _, ...request } = salesReadDuring({ basis, from, to }, commercial);
		return ctx.query(request);
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
				purchase_price: row.purchase_price ?? row.lot_unit_cost,
				supplier_payment_label: row.supplier_payment
					? ctx.t(`reports.sales.supplier_payment.${row.supplier_payment}`)
					: '',
				kind_label: ctx.t(`reports.sales.kind.${row.kind}`),
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
			return {
				currency,
				lines: lines.length,
				figures: [
					...(lines.length
						? [
								figure('net', sum(lines.map((line) => line.net))),
								figure('tax', sum(lines.map((line) => line.tax))),
								figure('freight', sum(lines.map((line) => line.freight)))
							]
						: []),
					...(hasCost && priced.length ? [figure('cost', cost), figure('margin', margin)] : [])
				],
				margin_rate:
					hasCost && priced.length && !BigDecimal.isZero(costedNet)
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

{#snippet orderCell({ row }: { row: NonNullable<typeof rows>[number] })}
	{#if row.order}
		{@const order = row.order}
		<button
			type="button"
			class="underline-offset-4 hover:underline focus-visible:underline"
			onclick={() => open_record('orders', order)}>{row.order_number}</button
		>
	{/if}
{/snippet}
{#snippet badge({ value }: { value: ShowProps['value'] })}{#if value}<Badge variant="outline"
			>{String(value)}</Badge
		>{/if}{/snippet}

<Stack size="fill" min_height="18rem" gap="sm">
	{#if facts.error || billing?.error || purchases?.error}
		<EmptyState tone="danger" title={ctx.t('reports.sales.incomplete')} />
	{:else if rows}
		{#each totals as total (total.currency)}
			<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
				<div>
					<dt class="text-xs text-muted-foreground">{ctx.t('reports.sales.lines')}</dt>
					<dd class="text-base font-semibold tabular-nums">{total.lines}</dd>
				</div>
				{#each total.figures as figure (figure.field)}
					<div>
						<dt class="text-xs text-muted-foreground">{ctx.t(`reports.sales.${figure.field}`)}</dt>
						<dd class="text-base font-semibold tabular-nums">
							<Show {ctx} kind={moneyKind} value={figure.value} row={total} />
						</dd>
					</div>
				{/each}
				{#if total.margin_rate !== null}
					<div>
						<dt class="text-xs text-muted-foreground">{ctx.t('reports.sales.margin_rate')}</dt>
						<dd class="text-base font-semibold tabular-nums">{total.margin_rate}%</dd>
					</div>
				{/if}
			</Grid>
		{/each}
		{#if chart}
			{@const series = marginSeries(rows).filter((row) => row.margin !== null)}
			{#each [...new Set(series.map((row) => row.currency))] as currency (currency)}
				<Chart
					{ctx}
					of={series.filter((row) => row.currency === currency)}
					x="salesperson"
					y="margin"
					orientation="horizontal"
					title={`${ctx.t('component.actual_margins')} · ${currency}`}
				/>
			{:else}<p class="text-sm text-muted-foreground">
					{ctx.t('component.unpriced_margin')}
				</p>{/each}
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
							kind: { kind: 'decimal', scale: 4, optional: true } as const,
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
			{ field: 'order_number', label: ctx.t('models.orders.singular'), cell: orderCell },
			{ field: 'ordered_on', label: label(ctx, 'orders', 'ordered_on'), kind: dateKind },
			{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
			{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
			{ field: 'kind_label', label: ctx.t('reports.sales.kind'), cell: badge },
			{ field: 'reference', label: ctx.t('reports.sales.reference') },
			{
				field: 'business_on',
				label: ctx.t(basis === 'invoice' ? 'reports.sales.date_invoice' : 'reports.sales.date_delivery'),
				kind: { kind: 'date' }
			},
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
				kind: { kind: 'decimal', scale: 4, optional: true },
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
			toolbar={{
				// a period past one read says so in the title, where it shifts nothing
				title: truncated
					? `${ctx.t('component.sales_analysis')} · ${ctx.t('reports.sales.truncated')}`
					: ctx.t('component.sales_analysis'),
				description: ctx.t('component.unpriced_margin'),
				new: false,
				actions: [
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
			}}
		>
			{#snippet empty()}<EmptyState
					title={ctx.t(
						basis === 'invoice' ? 'reports.sales.no_invoices' : 'reports.sales.no_deliveries'
					)}
				/>{/snippet}
		</Table>
	{:else}<EmptyState title={ctx.t('component.reports_loading')} />{/if}
</Stack>
