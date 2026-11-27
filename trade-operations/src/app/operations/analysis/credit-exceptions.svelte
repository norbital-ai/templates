<script lang="ts">
	// Credit exceptions: the customers that need credit attention today — held in Kingdee, over their limit, or with
	// overdue invoices — and the overdue invoices behind them. Credit and overdue amounts meet only in one currency.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		Show,
		Table,
		TableSkeleton,
		Tabs,
		label,
		open_record,
		type Col,
		type Kind
	} from '@norbital-ai/ui';
	import { Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { creditExceptions, creditRead, creditTotals, readAgingAt } from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx }: { ctx: PageContext } = $props();
	const day = ctx.clock('day');
	const hasSnapshots = $derived(Boolean(ctx.catalog?.credit_snapshots));
	const hasReleases = $derived(Boolean(ctx.catalog?.credit_releases));
	const commercialReleases = $derived(ctx.catalog?.credit_releases?.output === undefined);
	const credit = $derived(hasSnapshots ? ctx.query(creditRead) : null);
	const ages = $derived(
		Boolean(hasSnapshots && ctx.catalog?.transactions && ctx.catalog?.source_payments)
	);
	const aging = observe_once(() =>
		ages ? readAgingAt(ctx, day.today, Boolean(ctx.catalog?.source_receivables)) : null
	);
	const exceptions = $derived(
		!hasSnapshots
			? { customers: [], invoices: [] }
			: credit?.current && (!ages || aging.current || aging.error)
				? creditExceptions(
						credit.current.credit_snapshots.rows,
						aging.current?.rows ?? [],
						day.today
					)
				: null
	);
	const rows = $derived(
		exceptions?.customers.map((row) => ({
			...row,
			reasons: row.reasons.map((reason) => ctx.t(`reports.credit.${reason}`))
		})) ?? null
	);
	const openReleases = $derived(
		hasReleases
			? ctx.query({
					credit_releases: {
						...(commercialReleases ? {} : { output: 'logistics' as const }),
						where: { source_status: { in: ['blocked', 'bypassed'] } },
						fields: ['source_status'],
						limit: 500
					}
				})
			: null
	);
	const releaseAlertCount = $derived(openReleases?.current?.credit_releases.rows.length ?? 0);
	let chosenView = $state<'releases' | 'customers' | 'invoices' | null>(null);
	const view = $derived<'releases' | 'customers' | 'invoices'>(
		chosenView &&
			((chosenView === 'releases' && hasReleases) || (chosenView !== 'releases' && hasSnapshots))
			? chosenView
			: hasReleases && releaseAlertCount > 0
				? 'releases'
				: hasSnapshots
					? 'customers'
					: 'releases'
	);
	let customer = $state<{ keys: readonly string[]; name: string } | null>(null);
	const invoices = $derived(
		exceptions?.invoices.filter((row) => !customer || customer.keys.includes(row.customer)) ?? []
	);
	const totals = $derived(hasSnapshots ? creditTotals(rows ?? []) : []);
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const daysKind: Kind = { kind: 'int', optional: true };
	const releaseColumns = $derived(
		commercialReleases
			? ([
					'bill_number',
					'party',
					'order',
					'source_status',
					'approval_status',
					'bill_amount',
					'credit_limit',
					'credit_used',
					'over_limit',
					'overdue_days',
					'route',
					'released_by',
					'observed_at'
				] as const)
			: ([
					'bill_number',
					'party',
					'order',
					'source_status',
					'approval_status',
					'route',
					'released_by',
					'observed_at'
				] as const)
	);
</script>

{#snippet reasons({ row }: { row: NonNullable<typeof rows>[number] })}
	<Inline as="span" gap="xs"
		>{#each row.reasons as reason (reason)}<Badge variant="outline">{reason}</Badge>{/each}</Inline
	>
{/snippet}
{#snippet backToCustomers()}
	<Button
		variant="outline"
		onclick={() => {
			customer = null;
			chosenView = 'customers';
		}}>{ctx.t('reports.aging.all_customers')}</Button
	>
{/snippet}
{#snippet summary()}
	<Stack gap="sm">
		{#each totals as total (total.currency)}
			<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
				<div>
					<dt class="text-meta">{ctx.t('reports.aging.customers')}</dt>
					<dd class="text-heading tabular-nums">{total.customers}</dd>
				</div>
				{#each total.figures as figure (figure.field)}
					<div>
						<dt class="text-meta">{ctx.t(`reports.credit.${figure.field}`)}</dt>
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
	{@const list = rows ?? []}
	{@const columns: readonly Col<(typeof list)[number]>[] = [
		{ field: 'party_name', label: label(ctx, 'orders', 'party_name') },
		{ field: 'reasons', label: ctx.t('reports.credit.reasons'), cell: reasons },
		{ field: 'credit_limit', label: label(ctx, 'credit_snapshots', 'credit_limit'), kind: moneyKind, align: 'end' },
		{ field: 'credit_used', label: label(ctx, 'credit_snapshots', 'credit_used'), kind: moneyKind, align: 'end' },
		{ field: 'over_limit', label: ctx.t('reports.credit.over_limit'), kind: moneyKind, align: 'end' },
		{ field: 'overdue', label: ctx.t('reports.credit.overdue'), kind: moneyKind, align: 'end' },
		{ field: 'oldest_overdue', label: ctx.t('reports.aging.oldest_overdue'), kind: daysKind, align: 'end' }
	]}
	<Table
		{ctx}
		layout="grid"
		of={list}
		key="credit_exceptions"
		{columns}
		on_open={(row) => {
			customer = { keys: row.keys, name: [row.party_name, row.currency].join(' · ') };
			chosenView = 'invoices';
		}}
		toolbar={{
			title: ctx.t('component.credit_exceptions'),
			description: ctx.t('reports.credit.scope'),
			new: false,
			...(customer ? { controls: backToCustomers } : {}),
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () =>
						downloadXlsx(
							'credit-exceptions',
							day.today,
							columns,
							list.map((row) => ({ ...row, reasons: row.reasons.join(', ') }))
						)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.credit.empty')} />{/snippet}
	</Table>
{/snippet}
{#snippet invoicesTab()}
	{@const columns: readonly Col<(typeof invoices)[number]>[] = [
		{ field: 'reference', label: ctx.t('reports.aging.reference') },
		...(customer ? [] : [{ field: 'party_name' as const, label: label(ctx, 'orders', 'party_name') }]),
		{ field: 'order_number', label: ctx.t('models.orders.singular') },
		{ field: 'issued_on', label: ctx.t('models.transactions.fields.issued_on'), kind: { kind: 'date', optional: true } },
		{ field: 'due_on', label: label(ctx, 'orders', 'due_on'), kind: { kind: 'date', optional: true } },
		{ field: 'days_overdue', label: ctx.t('reports.aging.days_overdue'), kind: daysKind, align: 'end' },
		{ field: 'balance', label: ctx.t('reports.aging.balance'), kind: moneyKind, align: 'end' }
	]}
	<Table
		{ctx}
		layout="grid"
		of={invoices}
		key="credit_overdue"
		{columns}
		on_open={(row) => {
			if (row.invoice) open_record('transactions', row.invoice);
			else if (row.order) open_record('orders', row.order);
		}}
		toolbar={{
			title: [ctx.t('reports.credit.invoices'), customer?.name].filter(Boolean).join(' · '),
			description: ctx.t('reports.credit.scope'),
			new: false,
			...(customer ? { controls: backToCustomers } : {}),
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('credit-overdue', day.today, columns, invoices)
				}
			]
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.credit.empty')} />{/snippet}
	</Table>
{/snippet}

{#snippet releasesTab()}
	<Table
		{ctx}
		layout="grid"
		of="credit_releases"
		columns={releaseColumns}
		toolbar={{
			title: ctx.t('reports.credit.releases'),
			description: ctx.t('reports.credit.releases_scope'),
			new: false
		}}
	>
		{#snippet empty()}<EmptyState title={ctx.t('reports.credit.releases_empty')} />{/snippet}
	</Table>
{/snippet}

<Cover size="fill" min_height="18rem" gap="sm" {...totals.length > 0 ? { top: summary } : {}}>
	{#if credit?.error}<EmptyState tone="danger" title={credit.error.message} />
	{:else if aging.error}<EmptyState tone="danger" title={ctx.t('reports.aging.incomplete')} />
	{:else if hasSnapshots && !rows}
		<div aria-busy="true" aria-label={ctx.t('component.reports_loading')}><TableSkeleton /></div>
	{:else}
		<Tabs
			level={2}
			value={view}
			on_value_change={(next) => {
				chosenView =
					next === 'releases' ? 'releases' : next === 'invoices' ? 'invoices' : 'customers';
				customer = null;
			}}
			tabs={[
				...(hasSnapshots
					? [
							{ name: 'customers', title: ctx.t('reports.aging.customers'), body: customersTab },
							{ name: 'invoices', title: ctx.t('reports.credit.invoices'), body: invoicesTab }
						]
					: []),
				...(hasReleases
					? [
							{
								name: 'releases',
								title:
									releaseAlertCount > 0
										? `${ctx.t('reports.credit.releases')} (${releaseAlertCount})`
										: ctx.t('reports.credit.releases'),
								body: releasesTab
							}
						]
					: [])
			]}
		/>
	{/if}
</Cover>
