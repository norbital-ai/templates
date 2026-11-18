<script lang="ts">
	// Credit exceptions: the customers that need credit attention today — held in Kingdee, over their limit, or with
	// overdue invoices — and the overdue invoices behind them. Credit and overdue amounts meet only in one currency.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal, Effect } from 'effect';
	import {
		Badge,
		Button,
		EmptyState,
		Show,
		Table,
		label,
		open_record,
		type Col,
		type Kind
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { run } from '@norbital-ai/ui/effect';
	import { creditExceptions, creditRead, readAgingAt } from '../../../lib/reports.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx }: { ctx: PageContext } = $props();
	const day = ctx.clock('day');
	const credit = $derived(ctx.query(creditRead));
	const ages = $derived(Boolean(ctx.catalog?.transactions && ctx.catalog?.source_payments));
	type Aging = Effect.Success<ReturnType<typeof readAgingAt>>;
	let aging = $state.raw<Aging | null>(null);
	let failed = $state(false);
	$effect(() => {
		const today = day.today;
		aging = null;
		failed = false;
		if (!ages) return;
		let current = true;
		void run(readAgingAt(ctx, today, Boolean(ctx.catalog?.source_receivables))).then(
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
	const exceptions = $derived(
		credit.current && (!ages || aging || failed)
			? creditExceptions(credit.current.credit_snapshots.rows, aging?.rows ?? [], day.today)
			: null
	);
	const rows = $derived(
		exceptions?.customers.map((row) => ({
			...row,
			reasons: row.reasons.map((reason) => ctx.t(`reports.credit.${reason}`))
		})) ?? null
	);
	let view = $state<'customers' | 'invoices'>('customers');
	let customer = $state<{ keys: readonly string[]; name: string } | null>(null);
	const invoices = $derived(
		exceptions?.invoices.filter((row) => !customer || customer.keys.includes(row.customer)) ?? []
	);
	const totals = $derived(
		[...Map.groupBy(rows ?? [], (row) => row.currency)].map(([currency, group]) => ({
			currency,
			customers: group.length,
			figures: (['overdue', 'over_limit'] as const).map((field) => ({
				field,
				value: BigDecimal.format(
					BigDecimal.sumAll(
						group.flatMap((row) => (row[field] ? [BigDecimal.fromStringUnsafe(row[field])] : []))
					)
				)
			}))
		}))
	);
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
	const daysKind: Kind = { kind: 'int', optional: true };
</script>

{#snippet reasons({ row }: { row: NonNullable<typeof rows>[number] })}
	<span class="flex flex-nowrap gap-1"
		>{#each row.reasons as reason (reason)}<Badge variant="outline">{reason}</Badge>{/each}</span
	>
{/snippet}
{#snippet reference({ row }: { row: (typeof invoices)[number] })}
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
{#snippet controls()}
	<div class="flex flex-wrap items-center gap-2">
		<select
			aria-label={ctx.t('reports.aging.view')}
			bind:value={view}
			onchange={() => (customer = null)}
			class="h-8 rounded-md border border-input bg-background px-2 text-sm"
		>
			<option value="customers">{ctx.t('reports.aging.customers')}</option>
			<option value="invoices">{ctx.t('reports.credit.invoices')}</option>
		</select>
		{#if customer}
			<Button
				variant="outline"
				onclick={() => {
					customer = null;
					view = 'customers';
				}}>{ctx.t('reports.aging.all_customers')}</Button
			>
		{/if}
	</div>
{/snippet}

<Stack size="fill" min_height="18rem" gap="sm">
	{#each totals as total (total.currency)}
		<Grid as="dl" gap="sm" tracks="repeat(auto-fit,minmax(9rem,1fr))">
			<div>
				<dt class="text-xs text-muted-foreground">{ctx.t('reports.aging.customers')}</dt>
				<dd class="text-base font-semibold tabular-nums">{total.customers}</dd>
			</div>
			{#each total.figures as figure (figure.field)}
				<div>
					<dt class="text-xs text-muted-foreground">{ctx.t(`reports.credit.${figure.field}`)}</dt>
					<dd class="text-base font-semibold tabular-nums">
						<Show {ctx} kind={moneyKind} value={figure.value} row={total} />
					</dd>
				</div>
			{/each}
		</Grid>
	{/each}
	{#if credit.error}<EmptyState tone="danger" title={credit.error.message} />
	{:else if failed}<EmptyState tone="danger" title={ctx.t('reports.aging.incomplete')} />
	{:else if !rows}<EmptyState title={ctx.t('component.reports_loading')} />
	{:else if view === 'customers'}
		{@const columns: readonly Col<(typeof rows)[number]>[] = [
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
			of={rows}
			key="credit_exceptions"
			{columns}
			on_open={(row) => {
				customer = { keys: row.keys, name: [row.party_name, row.currency].join(' · ') };
				view = 'invoices';
			}}
			toolbar={{
				title: ctx.t('component.credit_exceptions'),
				description: ctx.t('reports.credit.scope'),
				new: false,
				controls,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('component.export_xlsx'),
						run: () =>
							downloadXlsx(
								'credit-exceptions',
								day.today,
								columns,
								rows.map((row) => ({ ...row, reasons: row.reasons.join(', ') }))
							)
					}
				]
			}}
		>
			{#snippet empty()}<EmptyState title={ctx.t('reports.credit.empty')} />{/snippet}
		</Table>
	{:else}
		{@const columns: readonly Col<(typeof invoices)[number]>[] = [
			{ field: 'reference', label: ctx.t('reports.aging.reference'), cell: reference },
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
			toolbar={{
				title: [ctx.t('reports.credit.invoices'), customer?.name].filter(Boolean).join(' · '),
				description: ctx.t('reports.credit.scope'),
				new: false,
				controls,
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
	{/if}
</Stack>
