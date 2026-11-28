<script lang="ts">
	// Purchase listing: one row per purchase order line in the period, read left to right as the order,
	// receipts, purchase invoices, customs/import VAT and supplier payments progressed.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal } from 'effect';
	import {
		Badge,
		Combobox,
		EmptyState,
		Label,
		Show,
		Surface,
		Table,
		TableSkeleton,
		format,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { earliestPurchaseListingDate } from '../../../lib/purchase-listing.js';
	import { purchaseListingTotals, readPurchaseListingAt } from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx, from, to }: { ctx: PageContext; from: string | null; to: string | null } = $props();
	const day = ctx.clock('day');
	let relation = $state<'all' | 'related' | 'third'>('all');
	const listing = observe_once(() =>
		readPurchaseListingAt(
			ctx,
			{ from, to },
			{
				sourcePurchaseOrders: Boolean(ctx.catalog?.source_purchase_orders),
				localOrders: Boolean(ctx.catalog?.orders)
			}
		)
	);
	const heads = $derived(listing.current?.heads ?? []);
	const notices = $derived(listing.current?.notices ?? []);
	const rows = $derived(
		listing.current?.rows
			.filter(
				(row) =>
					relation === 'all' || (relation === 'related' ? row.related_party : !row.related_party)
			)
			.map((row) => ({
				...row,
				party_relation: ctx.t(
					row.related_party ? 'reports.party.related' : 'reports.party.third_party'
				),
				payment_status_label: row.payment_status
					? ctx.t(`reports.purchases.status.${row.payment_status}`)
					: ''
			})) ?? null
	);
	const manyLedgers = $derived(new Set(rows?.map((row) => row.ledger)).size > 1);
	const kpiFields = new Set(['amount_base', 'invoice_amount', 'paid_amount', 'unpaid_amount']);
	const totals = $derived(
		purchaseListingTotals(rows ?? []).map((total) => ({
			...total,
			// Cap summary strip at 5 KPIs (lines + up to 4 non-zero base-currency figures)
			figures: total.figures
				.filter(
					(figure) =>
						kpiFields.has(figure.field) &&
						!BigDecimal.isZero(BigDecimal.fromStringUnsafe(figure.value))
				)
				.slice(0, 4)
		}))
	);
	const unattachedNotices = $derived(notices.filter((n) => n.unattached_rows > 0));
	const beforeStartNotices = $derived(notices.filter((n) => n.before_start_rows > 0));
	const about = $derived(
		[
			ctx.t('reports.purchases.scope'),
			...heads.map(
				(head) =>
					`${head.source.name} ${ctx.t('reports.aging.snapshot_at')} ${format(
						{ kind: 'instant' },
						head.observed_at,
						{
							locale: ctx.locale,
							...(ctx.tz == null ? {} : { zone: ctx.tz })
						}
					)}`
			),
			...beforeStartNotices.map((n) =>
				ctx.t('reports.purchases.before_start', {
					from: earliestPurchaseListingDate,
					count: n.before_start_rows,
					amount: `${n.before_start_amount} ${n.currency}`
				})
			)
		].join(' · ')
	);
	const qtyKind: Kind = { kind: 'decimal', scale: 3, optional: true };
	const priceMoneyKind: Kind = { kind: 'money', currency: 'currency', scale: 4, optional: true };
	const rateKind: Kind = { kind: 'decimal', scale: 6, optional: true };
	const origMoneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const baseMoneyKind: Kind = { kind: 'money', currency: 'base_currency', optional: true };
	const totalMoneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const dateKind: Kind = { kind: 'date', optional: true };
</script>

{#snippet badge({ value }: { value: ShowProps['value'] })}{#if value}<Badge variant="outline"
			>{String(value)}</Badge
		>{/if}{/snippet}
{#snippet controls()}
	<Cluster gap="sm" align="center">
		<Inline gap="sm" align="center">
			<Label for="purchase-party-relation">{ctx.t('reports.party.relation')}</Label>
			<Combobox
				id="purchase-party-relation"
				value={relation}
				options={[
					{ value: 'all', label: ctx.t('reports.party.all') },
					{ value: 'related', label: ctx.t('reports.party.related') },
					{ value: 'third', label: ctx.t('reports.party.third_party') }
				]}
				on_change={(value) => {
					if (value === 'all' || value === 'related' || value === 'third') relation = value;
				}}
			/>
		</Inline>
	</Cluster>
{/snippet}

<Stack size="fill" min_height="18rem" gap="sm">
	{#if listing.error}
		<EmptyState tone="danger" title={ctx.t('reports.purchases.incomplete')} />
	{:else if rows}
		{#each totals as total (total.currency)}
			<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
				<div>
					<dt class="text-meta">{ctx.t('reports.sales.lines')}</dt>
					<dd class="text-heading tabular-nums">{total.lines}</dd>
				</div>
				{#each total.figures as figure (figure.field)}
					<div>
						<dt class="text-meta">{ctx.t(`reports.purchases.${figure.field}`)}</dt>
						<dd class="text-heading tabular-nums">
							<Show {ctx} kind={totalMoneyKind} value={figure.value} row={total} />
						</dd>
					</div>
				{/each}
			</Grid>
		{/each}
		{#each unattachedNotices as notice (`${notice.ledger}:${notice.currency}`)}
			<Surface tone="subtle" padding="sm" radius="control" role="alert">
				<p class="text-sm text-destructive">
					{ctx.t('reports.purchases.unattached', {
						count: notice.unattached_rows,
						amount: `${notice.unattached_amount} ${notice.currency}`
					})}
				</p>
			</Surface>
		{/each}
		{@const columns: readonly Col<(typeof rows)[number]>[] = [
			{ field: 'supplier_name', label: ctx.t('reports.sales.supplier') },
			{ field: 'party_relation', label: ctx.t('reports.party.relation'), cell: badge },
			{ field: 'ordered_on', label: label(ctx, 'orders', 'ordered_on'), kind: { kind: 'date' } },
			{ field: 'order_number', label: ctx.t('reports.purchases.order_number') },
			{ field: 'product_category', label: ctx.t('models.products.fields.category') },
			{ field: 'product_spec', label: ctx.t('models.products.fields.spec') },
			{ field: 'quantity', label: ctx.t('reports.purchases.quantity'), kind: qtyKind, align: 'end' },
			{
				field: 'unit_price',
				label: ctx.t('reports.purchases.unit_price'),
				kind: priceMoneyKind,
				align: 'end'
			},
			{
				field: 'exchange_rate',
				label: ctx.t('reports.purchases.exchange_rate'),
				kind: rateKind,
				align: 'end'
			},
			{
				field: 'amount',
				label: ctx.t('reports.purchases.amount'),
				kind: origMoneyKind,
				align: 'end'
			},
			{
				field: 'amount_base',
				label: ctx.t('reports.purchases.amount_base'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{
				field: 'received_qty',
				label: ctx.t('reports.purchases.received_qty'),
				kind: qtyKind,
				align: 'end'
			},
			{
				field: 'last_received_on',
				label: ctx.t('reports.purchases.last_received_on'),
				kind: dateKind
			},
			{
				field: 'unreceived_qty',
				label: ctx.t('reports.purchases.unreceived_qty'),
				kind: qtyKind,
				align: 'end'
			},
			{ field: 'invoice_numbers', label: ctx.t('reports.sales.invoice_numbers') },
			{ field: 'invoiced_on', label: ctx.t('reports.sales.date_invoice'), kind: dateKind },
			{
				field: 'invoiced_qty',
				label: ctx.t('reports.purchases.invoiced_qty'),
				kind: qtyKind,
				align: 'end'
			},
			{
				field: 'invoice_amount',
				label: ctx.t('reports.purchases.invoice_amount'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{ field: 'duty', label: ctx.t('reports.purchases.duty'), kind: baseMoneyKind, align: 'end' },
			{
				field: 'vat_amount',
				label: ctx.t('reports.purchases.vat_amount'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{
				field: 'net_amount',
				label: ctx.t('reports.purchases.net_amount'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{ field: 'settlement', label: ctx.t('reports.aging.settlement') },
			{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), kind: dateKind },
			{
				field: 'paid_amount',
				label: ctx.t('reports.purchases.paid_amount'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{ field: 'paid_on', label: ctx.t('reports.purchases.paid_on'), kind: dateKind },
			{
				field: 'unpaid_amount',
				label: ctx.t('reports.purchases.unpaid_amount'),
				kind: baseMoneyKind,
				align: 'end'
			},
			{
				field: 'payment_status_label',
				label: ctx.t('reports.purchases.payment_status'),
				cell: badge
			},
			{ field: 'note', label: ctx.t('models.orders.fields.notes') },
			...(manyLedgers ? [{ field: 'ledger_name' as const, label: ctx.t('reports.aging.ledger') }] : [])
		]}
		<Table
			{ctx}
			layout="grid"
			of={rows}
			key="purchase_listing"
			{columns}
			on_open={(row) => {
				if (row.order) open_record('orders', row.order);
			}}
			toolbar={{
				title: ctx.t('component.purchase_listing'),
				description: about,
				new: false,
				controls,
				actions:
					rows.length > 0
						? [
								{
									icon: 'lucide:file-spreadsheet',
									name: ctx.t('component.export_xlsx'),
									run: () => downloadXlsx('purchase-listing', day.today, columns, rows)
								}
							]
						: []
			}}
		>
			{#snippet empty()}<EmptyState title={ctx.t('reports.purchases.empty')} />{/snippet}
		</Table>
	{:else}
		<div aria-busy="true" aria-label={ctx.t('component.reports_loading')}><TableSkeleton /></div>
	{/if}
</Stack>
