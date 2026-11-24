<script lang="ts">
	// Payables aging: what is owed to each supplier on the cutoff, how long past due, unmatched payments,
	// related vs third-party split, and GL 2202.03 accrued-not-invoiced balance noted beside the report.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal } from 'effect';
	import {
		Badge,
		Button,
		Combobox,
		EmptyState,
		Label,
		Show,
		Table,
		TableSkeleton,
		Tabs,
		format,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Cluster, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { observe_once } from '@norbital-ai/ui/effect';
	import {
		agingBuckets,
		agingGroup,
		agingSummary,
		daysOverdue,
		estimateAging,
		payablePartySplit,
		readPayablesAgingAt
	} from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx, as_of }: { ctx: PageContext; as_of: string } = $props();
	const day = ctx.clock('day');
	const future = $derived(as_of > day.today);
	let view = $state<'suppliers' | 'entries'>('suppliers');
	let basis = $state<'estimated' | 'gross'>('estimated');
	let relation = $state<'all' | 'related' | 'third'>('all');
	let supplier = $state<{ key: string; name: string } | null>(null);
	const aging = observe_once(() =>
		as_of > day.today
			? null
			: readPayablesAgingAt(ctx, as_of, Boolean(ctx.catalog?.source_payables))
	);
	const heads = $derived(aging.current?.heads ?? []);
	const accruals = $derived(aging.current?.accruals ?? []);
	const relatedKeys = $derived(aging.current?.relatedKeys ?? new Set<string>());
	const estimated = $derived(heads.length > 0 && basis === 'estimated');
	const entries = $derived(
		aging.current?.rows
			? estimated
				? estimateAging(aging.current.rows)
				: aging.current.rows
			: null
	);
	const manyLedgers = $derived(new Set(entries?.map((row) => row.ledger)).size > 1);
	const nonZero = <R,>(rows: readonly R[], amount: (row: R) => string | null) =>
		rows.some((row) => {
			const value = amount(row);
			return value !== null && !BigDecimal.isZero(BigDecimal.fromStringUnsafe(value));
		});
	const isPositiveValue = (value: string) =>
		BigDecimal.isPositive(BigDecimal.fromStringUnsafe(value));
	const overdueDays = (due: string | null) => daysOverdue(due, as_of) || null;
	const isRelated = (ledger: string, party: string) => relatedKeys.has(`${ledger}:${party}`);

	const suppliers = $derived.by(() => {
		if (!entries) return null;
		const byGroup = Map.groupBy(entries, agingGroup);
		return agingSummary(entries)
			.map((row) => {
				const net = BigDecimal.fromStringUnsafe(row.net);
				const matching = byGroup.get(row.group) ?? [];
				const first = matching[0];
				const related = first ? isRelated(first.ledger, first.party) : false;
				const oldest = matching.reduce<number | null>((max, entry) => {
					if (entry.bucket === 'unapplied') return max;
					const days = overdueDays(entry.due_on);
					return days !== null && (max === null || days > max) ? days : max;
				}, null);
				return {
					...row,
					related_party: related,
					party_relation: ctx.t(related ? 'reports.party.related' : 'reports.party.third_party'),
					owed: BigDecimal.format(BigDecimal.isPositive(net) ? net : BigDecimal.fromBigInt(0n)),
					in_credit: BigDecimal.format(
						BigDecimal.isNegative(net) ? BigDecimal.negate(net) : BigDecimal.fromBigInt(0n)
					),
					oldest_overdue: oldest
				};
			})
			.toSorted((a, b) =>
				BigDecimal.Order(BigDecimal.fromStringUnsafe(b.net), BigDecimal.fromStringUnsafe(a.net))
			);
	});
	const shownSuppliers = $derived(
		suppliers?.filter(
			(row) =>
				(!supplier || row.group === supplier.key) &&
				(relation === 'all' || (relation === 'related' ? row.related_party : !row.related_party))
		) ?? []
	);
	const overdueBuckets = ['1_30', '31_60', '61_90', 'over_90'] as const;
	const splits = $derived(payablePartySplit(shownSuppliers));
	const totals = $derived(
		[...Map.groupBy(shownSuppliers, (row) => row.currency)].map(([currency, rows]) => {
			const payable = BigDecimal.format(
				BigDecimal.sumAll(rows.map((row) => BigDecimal.fromStringUnsafe(row.owed)))
			);
			const prepaid = BigDecimal.format(
				BigDecimal.sumAll(rows.map((row) => BigDecimal.fromStringUnsafe(row.in_credit)))
			);
			const overdue = BigDecimal.format(
				BigDecimal.sumAll(
					rows.flatMap((row) =>
						overdueBuckets.map((bucket) => BigDecimal.fromStringUnsafe(row[bucket]))
					)
				)
			);
			const split = splits.find((s) => s.currency === currency);
			const periodAccrual = accruals.find(
				(a) => a.currency === currency && !BigDecimal.isZero(BigDecimal.fromStringUnsafe(a.amount))
			);
			// Cap summary strip at 5 KPIs, omitting zero-value tiles
			const cards: { readonly key: string; readonly label: string; readonly value: string }[] = [
				{ key: 'payable', label: ctx.t('reports.payables.payable'), value: payable },
				...(isPositiveValue(overdue)
					? [{ key: 'overdue', label: ctx.t('reports.payables.overdue'), value: overdue }]
					: []),
				...(isPositiveValue(prepaid)
					? [{ key: 'prepaid', label: ctx.t('reports.payables.prepaid'), value: prepaid }]
					: []),
				...(relation === 'all' && split && isPositiveValue(split.related.payable)
					? [
							{
								key: 'related',
								label: ctx.t('reports.payables.related_payable'),
								value: split.related.payable
							}
						]
					: []),
				...(periodAccrual
					? [
							{
								key: `accrual:${periodAccrual.period}`,
								label: ctx.t('reports.payables.accrual_label', { period: periodAccrual.period }),
								value: periodAccrual.amount
							}
						]
					: [])
			].slice(0, 5);
			return { currency, cards };
		})
	);
	const entryRows = $derived(
		entries
			?.filter((row) => {
				const related = isRelated(row.ledger, row.party);
				return (
					(!supplier || agingGroup(row) === supplier.key) &&
					(relation === 'all' || (relation === 'related' ? related : !related))
				);
			})
			.map((row) => {
				const kind = 'entry_kind' in row ? row.entry_kind : undefined;
				return {
					estimated_applied: null,
					estimated_balance: null,
					...row,
					entry_kind_label: kind ? ctx.t(`reports.payables.kind.${kind}`) : '',
					days_overdue: row.bucket === 'unapplied' ? null : overdueDays(row.due_on),
					bucket_label: ctx.t(`reports.aging.${row.bucket}`)
				};
			}) ?? []
	);
	const scope = $derived(
		ctx.t(
			estimated
				? 'reports.payables.estimate_scope'
				: heads.length
					? 'reports.payables.account_scope'
					: 'reports.payables.cutoff_scope'
		)
	);
	const currentPeriod = $derived(day.today.slice(0, 7));
	const about = $derived(
		[
			scope,
			...heads
				.filter((head) => head.shard === 0)
				.map(
					(head) =>
						`${head.source?.name ?? ''} ${ctx.t('reports.aging.snapshot_at')} ${format(
							{ kind: 'instant' },
							head.observed_at,
							{
								locale: ctx.locale,
								...(ctx.tz == null ? {} : { zone: ctx.tz })
							}
						)}`
				),
			...accruals.map((accrual) =>
				ctx.t(
					accrual.period === currentPeriod
						? 'reports.payables.accrual_open_month'
						: 'reports.payables.accrual_period',
					{
						period: accrual.period,
						amount: `${accrual.amount} ${accrual.currency}`
					}
				)
			)
		].join(' · ')
	);
	const title = $derived([ctx.t('component.ap_aging'), supplier?.name].filter(Boolean).join(' · '));
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const dateKind: Kind = { kind: 'date', optional: true };
	const daysKind: Kind = { kind: 'int', optional: true };
	const money = <
		F extends
			| 'owed'
			| 'in_credit'
			| 'balance'
			| 'unapplied'
			| 'credit'
			| 'overpaid'
			| 'estimated_applied'
			| 'estimated_balance'
			| (typeof agingBuckets)[number]
	>(
		field: F,
		labelKey?:
			'reports.payables.payable' | 'reports.payables.prepaid' | 'reports.payables.unapplied'
	) => ({
		field,
		kind: moneyKind,
		label: labelKey ? ctx.t(labelKey) : ctx.t(`reports.aging.${field}`),
		align: 'end' as const
	});
</script>

{#snippet controls()}
	<Cluster gap="sm" align="center">
		{#if heads.length}
			<Inline gap="sm" align="center">
				<Label for="ap-aging-basis">{ctx.t('reports.aging.basis')}</Label>
				<Combobox
					id="ap-aging-basis"
					value={basis}
					options={[
						{ value: 'estimated', label: ctx.t('reports.aging.basis_estimated') },
						{ value: 'gross', label: ctx.t('reports.aging.basis_gross') }
					]}
					on_change={(value) => {
						if (value !== null) basis = value;
					}}
				/>
			</Inline>
		{/if}
		<Inline gap="sm" align="center">
			<Label for="ap-party-relation">{ctx.t('reports.party.relation')}</Label>
			<Combobox
				id="ap-party-relation"
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
		{#if supplier}
			<Button
				variant="outline"
				onclick={() => {
					supplier = null;
					view = 'suppliers';
				}}>{ctx.t('reports.payables.all_suppliers')}</Button
			>
		{/if}
	</Cluster>
{/snippet}
{#snippet badge({ value }: { value: ShowProps['value'] })}<Badge variant="outline"
		>{String(value ?? '—')}</Badge
	>{/snippet}
{#snippet summary()}
	<Stack gap="sm">
		{#each totals as total (total.currency)}
			<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
				{#each total.cards as card (card.key)}
					<div>
						<dt class="text-meta">{card.label}</dt>
						<dd class="text-heading tabular-nums">
							<Show {ctx} kind={moneyKind} value={card.value} row={total} />
						</dd>
					</div>
				{/each}
			</Grid>
		{/each}
	</Stack>
{/snippet}
{#snippet suppliersTab()}
	{@const columns: readonly Col<(typeof shownSuppliers)[number]>[] = [
		{ field: 'party_name', label: ctx.t('reports.sales.supplier') },
		{ field: 'party_relation', label: ctx.t('reports.party.relation'), cell: badge },
		money('owed', 'reports.payables.payable'),
		money('in_credit', 'reports.payables.prepaid'),
		...(estimated ? [money('estimated_balance')] : []),
		...agingBuckets.map((field) => money(field)),
		{
			field: 'oldest_overdue',
			label: ctx.t('reports.aging.oldest_overdue'),
			kind: daysKind,
			align: 'end'
		},
		...(['unapplied', 'credit', 'overpaid'] as const).flatMap((field) =>
			nonZero(shownSuppliers, (row) => row[field])
				? [money(field, field === 'unapplied' ? 'reports.payables.unapplied' : undefined)]
				: []
		),
		...(manyLedgers ? [{ field: 'ledger_name' as const, label: ctx.t('reports.aging.ledger') }] : [])
	]}
	<Table
		{ctx}
		layout="grid"
		of={shownSuppliers}
		key="ap_suppliers"
		{columns}
		on_open={(row) => {
			supplier = {
				key: row.group,
				name: [row.party_name, manyLedgers ? row.ledger_name : '', row.currency]
					.filter(Boolean)
					.join(' · ')
			};
			view = 'entries';
		}}
		toolbar={{
			title,
			description: about,
			new: false,
			controls,
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('ap-aging-suppliers', day.today, columns, shownSuppliers)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.payables.empty')} />{/snippet}
	</Table>
{/snippet}
{#snippet entriesTab()}
	{@const columns: readonly Col<(typeof entryRows)[number]>[] = [
		{ field: 'reference', label: ctx.t('reports.aging.reference') },
		...(entryRows.some((row) => row.entry_kind_label)
			? [{ field: 'entry_kind_label' as const, label: ctx.t('reports.sales.kind'), cell: badge }]
			: []),
		...(supplier ? [] : [{ field: 'party_name' as const, label: ctx.t('reports.sales.supplier') }]),
		...(entryRows.some((row) => row.order_number)
			? [{ field: 'order_number' as const, label: ctx.t('models.orders.singular') }]
			: []),
		{ field: 'issued_on', label: ctx.t('models.transactions.fields.issued_on'), kind: dateKind },
		...(entryRows.some((row) => row.delivered_on)
			? [
					{
						field: 'delivered_on' as const,
						label: ctx.t('reports.payables.received_on'),
						kind: dateKind
					}
				]
			: []),
		{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), kind: dateKind },
		{
			field: 'days_overdue',
			label: ctx.t('reports.aging.days_overdue'),
			kind: daysKind,
			align: 'end'
		},
		{ field: 'bucket_label', label: ctx.t('reports.aging.bucket'), cell: badge },
		...(entryRows.some((row) => row.settlement)
			? [{ field: 'settlement' as const, label: ctx.t('reports.aging.settlement') }]
			: []),
		money('balance'),
		...(estimated ? [money('estimated_applied'), money('estimated_balance')] : []),
		...(['unapplied', 'credit', 'overpaid'] as const).flatMap((field) =>
			nonZero(entryRows, (row) => row[field])
				? [money(field, field === 'unapplied' ? 'reports.payables.unapplied' : undefined)]
				: []
		),
		...(entryRows.some((row) => row.settled_on)
			? [{ field: 'settled_on' as const, label: ctx.t('reports.purchases.paid_on'), kind: dateKind }]
			: []),
		...(manyLedgers ? [{ field: 'ledger_name' as const, label: ctx.t('reports.aging.ledger') }] : [])
	]}
	<Table
		{ctx}
		layout="grid"
		of={entryRows}
		key="ap_aging"
		{columns}
		on_open={(row) => {
			if (row.invoice) open_record('transactions', row.invoice);
			else if (row.order) open_record('orders', row.order);
		}}
		toolbar={{
			title,
			description: about,
			new: false,
			controls,
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('ap-aging-entries', day.today, columns, entryRows)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.payables.empty')} />{/snippet}
	</Table>
{/snippet}

<Cover size="fill" min_height="18rem" gap="sm" {...totals.length > 0 ? { top: summary } : {}}>
	{#if future}<EmptyState tone="danger" title={ctx.t('errors.report_future')} />
	{:else if aging.error}<EmptyState tone="danger" title={ctx.t('reports.payables.incomplete')} />
	{:else if aging.current && aging.current.rows === null}<EmptyState
			tone="danger"
			title={ctx.t('reports.aging.early_cutoff')}
		/>
	{:else if !entries}
		<div aria-busy="true" aria-label={ctx.t('component.reports_loading')}><TableSkeleton /></div>
	{:else}
		<Tabs
			level={2}
			value={view}
			on_value_change={(next) => {
				view = next === 'entries' ? 'entries' : 'suppliers';
				supplier = null;
			}}
			tabs={[
				{ name: 'suppliers', title: ctx.t('reports.payables.suppliers'), body: suppliersTab },
				{ name: 'entries', title: ctx.t('reports.aging.entries'), body: entriesTab }
			]}
		/>
	{/if}
</Cover>
