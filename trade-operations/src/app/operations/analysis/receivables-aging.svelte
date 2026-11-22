<script lang="ts">
	// Receivables aging: what each customer owes on the cutoff, how long past due, and what credit offsets it.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal, Effect } from 'effect';
	import {
		Badge,
		Button,
		Combobox,
		EmptyState,
		Label,
		Show,
		Table,
		Tabs,
		format,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Cluster, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { run } from '@norbital-ai/ui/effect';
	import {
		agingBuckets,
		agingGroup,
		agingSummary,
		daysOverdue,
		estimateAging,
		readAgingAt
	} from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx, as_of }: { ctx: PageContext; as_of: string } = $props();
	const day = ctx.clock('day');
	const future = $derived(as_of > day.today);
	let view = $state<'customers' | 'entries'>('customers');
	let basis = $state<'estimated' | 'gross'>('estimated');
	let customer = $state<{ key: string; name: string } | null>(null);
	type Aging = Effect.Success<ReturnType<typeof readAgingAt>>;
	let aging = $state.raw<Aging | null>(null);
	let failed = $state(false);
	$effect(() => {
		const cutoff = as_of;
		aging = null;
		failed = false;
		if (cutoff > day.today) return;
		let current = true;
		void run(readAgingAt(ctx, cutoff, Boolean(ctx.catalog?.source_receivables))).then(
			(answer) => {
				if (current) aging = answer;
			},
			() => {
				if (current) failed = true;
			}
		);
		return () => {
			current = false;
		};
	});
	const heads = $derived(aging?.heads ?? []);
	const estimated = $derived(heads.length > 0 && basis === 'estimated');
	const entries = $derived(
		aging?.rows ? (estimated ? estimateAging(aging.rows) : aging.rows) : null
	);
	const manyLedgers = $derived(new Set(entries?.map((row) => row.ledger)).size > 1);
	const nonZero = <R,>(rows: readonly R[], amount: (row: R) => string | null) =>
		rows.some((row) => {
			const value = amount(row);
			return value !== null && !BigDecimal.isZero(BigDecimal.fromStringUnsafe(value));
		});
	const overdueDays = (due: string | null) => daysOverdue(due, as_of) || null;
	// each customer: what is owed or held in credit, its buckets, and its oldest overdue invoice; largest owed first
	const customers = $derived(
		entries
			? agingSummary(entries)
					.map((row) => {
						const net = BigDecimal.fromStringUnsafe(row.net);
						const oldest = entries
							.filter((entry) => agingGroup(entry) === row.group && entry.bucket !== 'unapplied')
							.reduce<number | null>((max, entry) => {
								const days = overdueDays(entry.due_on);
								return days !== null && (max === null || days > max) ? days : max;
							}, null);
						return {
							...row,
							owed: BigDecimal.format(BigDecimal.isPositive(net) ? net : BigDecimal.fromBigInt(0n)),
							in_credit: BigDecimal.format(
								BigDecimal.isNegative(net) ? BigDecimal.negate(net) : BigDecimal.fromBigInt(0n)
							),
							oldest_overdue: oldest
						};
					})
					.toSorted((a, b) =>
						BigDecimal.Order(BigDecimal.fromStringUnsafe(b.net), BigDecimal.fromStringUnsafe(a.net))
					)
			: null
	);
	const shownCustomers = $derived(
		customers?.filter((row) => !customer || row.group === customer.key) ?? []
	);
	const overdueBuckets = ['1_30', '31_60', '61_90', 'over_90'] as const;
	const totals = $derived(
		[...Map.groupBy(shownCustomers, (row) => row.currency)].map(([currency, rows]) => ({
			currency,
			figures: [
				{
					field: 'owed' as const,
					value: BigDecimal.format(
						BigDecimal.sumAll(rows.map((row) => BigDecimal.fromStringUnsafe(row.owed)))
					)
				},
				{
					field: 'in_credit' as const,
					value: BigDecimal.format(
						BigDecimal.sumAll(rows.map((row) => BigDecimal.fromStringUnsafe(row.in_credit)))
					)
				},
				{
					field: 'overdue' as const,
					value: BigDecimal.format(
						BigDecimal.sumAll(
							rows.flatMap((row) =>
								overdueBuckets.map((bucket) => BigDecimal.fromStringUnsafe(row[bucket]))
							)
						)
					)
				}
			]
		}))
	);
	const entryRows = $derived(
		entries
			?.filter((row) => !customer || agingGroup(row) === customer.key)
			.map((row) => ({
				estimated_applied: null,
				estimated_balance: null,
				...row,
				days_overdue: row.bucket === 'unapplied' ? null : overdueDays(row.due_on),
				bucket_label: ctx.t(`reports.aging.${row.bucket}`)
			})) ?? []
	);
	const scope = $derived(
		ctx.t(
			estimated
				? 'reports.aging.estimate_scope'
				: heads.length
					? 'reports.aging.account_scope'
					: 'reports.aging.cutoff_scope'
		)
	);
	// what the figures rest on, behind the table's info icon: the basis and each ledger's snapshot time
	const about = $derived(
		[
			scope,
			...heads.map(
				(head) =>
					`${head.source?.name ?? ''} ${ctx.t('reports.aging.snapshot_at')} ${format(
						{ kind: 'instant' },
						head.observed_at,
						{
							locale: ctx.locale,
							...(ctx.tz == null ? {} : { zone: ctx.tz })
						}
					)}`
			)
		].join(' · ')
	);
	const title = $derived([ctx.t('component.ar_aging'), customer?.name].filter(Boolean).join(' · '));
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
		field: F
	) => ({
		field,
		kind: moneyKind,
		label: ctx.t(`reports.aging.${field}`),
		align: 'end' as const
	});
</script>

{#snippet controls()}
	<Cluster gap="sm" align="center">
		{#if heads.length}
			<Inline gap="sm" align="center">
				<Label for="ar-aging-basis">{ctx.t('reports.aging.basis')}</Label>
				<Combobox
					id="ar-aging-basis"
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
		{#if customer}
			<Button
				variant="outline"
				onclick={() => {
					customer = null;
					view = 'customers';
				}}>{ctx.t('reports.aging.all_customers')}</Button
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
				{#each total.figures as figure (figure.field)}
					<div>
						<dt class="text-meta">{ctx.t(`reports.aging.${figure.field}`)}</dt>
						<dd class="text-heading tabular-nums">
							<Show {ctx} kind={moneyKind} value={figure.value} row={total} />
						</dd>
					</div>
				{/each}
			</Grid>
		{/each}
	</Stack>
{/snippet}
{#snippet customersTab()}
	{@const columns: readonly Col<(typeof shownCustomers)[number]>[] = [
		{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
		money('owed'),
		money('in_credit'),
		...(estimated ? [money('estimated_balance')] : []),
		...agingBuckets.map((field) => money(field)),
		{
			field: 'oldest_overdue',
			label: ctx.t('reports.aging.oldest_overdue'),
			kind: daysKind,
			align: 'end'
		},
		...(['unapplied', 'credit', 'overpaid'] as const).flatMap((field) =>
			nonZero(shownCustomers, (row) => row[field]) ? [money(field)] : []
		),
		...(manyLedgers ? [{ field: 'ledger_name' as const, label: ctx.t('reports.aging.ledger') }] : [])
	]}
	<Table
		{ctx}
		layout="grid"
		of={shownCustomers}
		key="ar_customers"
		{columns}
		on_open={(row) => {
			customer = {
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
			...(heads.length || customer ? { controls } : {}),
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('ar-aging-customers', day.today, columns, shownCustomers)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.aging.empty')} />{/snippet}
	</Table>
{/snippet}
{#snippet entriesTab()}
	{@const columns: readonly Col<(typeof entryRows)[number]>[] = [
		{ field: 'reference', label: ctx.t('reports.aging.reference') },
		...(customer ? [] : [{ field: 'party_name' as const, label: label(ctx, 'orders', 'party_name') }]),
		{ field: 'order_number', label: ctx.t('models.orders.singular') },
		{ field: 'issued_on', label: ctx.t('models.transactions.fields.issued_on'), kind: dateKind },
		...(entryRows.some((row) => row.delivered_on)
			? [{ field: 'delivered_on' as const, label: ctx.t('reports.aging.delivered_on'), kind: dateKind }]
			: []),
		{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), kind: dateKind },
		{ field: 'days_overdue', label: ctx.t('reports.aging.days_overdue'), kind: daysKind, align: 'end' },
		{ field: 'bucket_label', label: ctx.t('reports.aging.bucket'), cell: badge },
		...(entryRows.some((row) => row.settlement)
			? [{ field: 'settlement' as const, label: ctx.t('reports.aging.settlement') }]
			: []),
		money('balance'),
		...(estimated ? [money('estimated_applied'), money('estimated_balance')] : []),
		...(['unapplied', 'credit', 'overpaid'] as const).flatMap((field) =>
			nonZero(entryRows, (row) => row[field]) ? [money(field)] : []
		),
		...(entryRows.some((row) => row.settled_on)
			? [{ field: 'settled_on' as const, label: ctx.t('reports.aging.receipt_date'), kind: dateKind }]
			: []),
		...(manyLedgers ? [{ field: 'ledger_name' as const, label: ctx.t('reports.aging.ledger') }] : [])
	]}
	<Table
		{ctx}
		layout="grid"
		of={entryRows}
		key="ar_aging"
		{columns}
		on_open={(row) => {
			if (row.invoice) open_record('transactions', row.invoice);
			else if (row.order) open_record('orders', row.order);
		}}
		toolbar={{
			title,
			description: about,
			new: false,
			...(heads.length || customer ? { controls } : {}),
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('ar-aging-entries', day.today, columns, entryRows)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.aging.empty')} />{/snippet}
	</Table>
{/snippet}

<Cover size="fill" min_height="18rem" gap="sm" {...totals.length > 0 ? { top: summary } : {}}>
	{#if future}<EmptyState tone="danger" title={ctx.t('errors.report_future')} />
	{:else if failed}<EmptyState tone="danger" title={ctx.t('reports.aging.incomplete')} />
	{:else if aging && aging.rows === null}<EmptyState
			tone="danger"
			title={ctx.t('reports.aging.early_cutoff')}
		/>
	{:else if !entries}<EmptyState title={ctx.t('component.reports_loading')} />
	{:else}
		<Tabs
			level={2}
			value={view}
			on_value_change={(next) => {
				view = next === 'entries' ? 'entries' : 'customers';
				customer = null;
			}}
			tabs={[
				{ name: 'customers', title: ctx.t('reports.aging.customers'), body: customersTab },
				{ name: 'entries', title: ctx.t('reports.aging.entries'), body: entriesTab }
			]}
		/>
	{/if}
</Cover>
