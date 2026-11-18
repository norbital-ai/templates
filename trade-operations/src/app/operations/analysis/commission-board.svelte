<script lang="ts">
	// Commission: what each salesperson earns for the month from its shipments and returns, line by line, what is
	// still pending and why, and whether the month's statement is approved.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal, Effect } from 'effect';
	import {
		Badge,
		Button,
		Dialog,
		EmptyState,
		Form,
		Show,
		Table,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { run } from '@norbital-ai/ui/effect';
	import { boardRead, completeCommissionBoard, monthOf } from '../../../lib/monthly-commission.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx, period: month }: { ctx: PageContext; period: string } = $props();
	const day = ctx.clock('day');
	const period = $derived(monthOf(month));
	const request = $derived(
		boardRead(period, ctx.catalog?.source_sales_lines?.output === 'commercial', undefined, 10_000)
	);
	const first = $derived(ctx.query(request));
	type Board = Effect.Success<ReturnType<typeof completeCommissionBoard>>;
	let board = $state.raw<Board | null>(null);
	let failed = $state<string | null>(null);
	$effect(() => {
		const answer = first.current;
		const read = request;
		const at = period;
		board = null;
		failed = null;
		if (!answer) return;
		let current = true;
		void run(completeCommissionBoard(ctx, read, answer, at)).then(
			(rows) => {
				if (current) board = rows;
			},
			(failure: unknown) => {
				if (current) failed = failure instanceof Error ? failure.message : String(failure);
			}
		);
		return () => {
			current = false;
		};
	});
	let view = $state<'salespeople' | 'lines'>('salespeople');
	let selection = $state<Board[number] | null>(null);
	const people = $derived(
		board?.map((row) => {
			// a basis quantity adds only within one basis unit (tonnes); several units list each
			const units = [
				...Map.groupBy(
					row.lines.filter((line) => line.basis_quantity !== null),
					(line) => line.basis_unit
				)
			];
			return {
				...row,
				basis_quantity: units
					.map(
						([unit, lines]) =>
							`${BigDecimal.format(BigDecimal.sumAll(lines.map((line) => BigDecimal.fromStringUnsafe(line.basis_quantity ?? '0'))))} ${unit}`
					)
					.join(' · '),
				state_label: ctx.t(`reports.commission_ack.${row.state}`)
			};
		}) ?? []
	);
	const lines = $derived(
		board?.flatMap((row) =>
			row.lines.map((line) => ({
				...line,
				owner_name: row.owner_name,
				currency: row.currency,
				reason_label: ctx.t(`reports.commission.${line.reason}`)
			}))
		) ?? []
	);
	const moneyKind: Kind = { kind: 'money', currency: 'currency', optional: true };
</script>

{#snippet badge({ value }: { value: ShowProps['value'] })}<Badge variant="outline"
		>{String(value ?? '—')}</Badge
	>{/snippet}
{#snippet statement({ row }: { row: (typeof people)[number] })}
	{#if row.latest_number}{row.latest_number}{/if}
	{#if ctx.catalog?.commission_statements?.create && ['unacknowledged', 'changed'].includes(row.state)}<Button
			onclick={() => (selection = row)}>{ctx.t('component.commission_acknowledge')}</Button
		>{/if}
{/snippet}
{#snippet orderCell({ row }: { row: (typeof lines)[number] })}
	<button
		type="button"
		class="underline-offset-4 hover:underline focus-visible:underline"
		onclick={() => open_record('orders', row.order)}>{row.number}</button
	>
{/snippet}
{#snippet controls()}
	<select
		aria-label={ctx.t('reports.aging.view')}
		bind:value={view}
		class="h-8 rounded-md border border-input bg-background px-2 text-sm"
	>
		<option value="salespeople">{ctx.t('reports.commission.salespeople')}</option>
		<option value="lines">{ctx.t('reports.commission.lines')}</option>
	</select>
{/snippet}

<Stack size="fill" min_height="18rem" gap="sm">
	{#if failed !== null || first.error}<EmptyState
			tone="danger"
			title={failed ?? first.error?.message ?? ''}
		/>
	{:else if !board}<EmptyState title={ctx.t('component.reports_loading')} />
	{:else if view === 'salespeople'}
		{@const peopleColumns: readonly Col<(typeof people)[number]>[] = [
		{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
		{ field: 'order_count', label: label(ctx, 'commission_statements', 'order_count'), align: 'end' },
		{ field: 'basis_quantity', label: ctx.t('reports.commission.basis_quantity'), align: 'end' },
		{ field: 'amount', label: label(ctx, 'orders', 'amount'), kind: moneyKind, align: 'end' },
		{ field: 'latest_amount', label: ctx.t('component.commission_previous'), kind: moneyKind, align: 'end' },
		{ field: 'unresolved_lines', label: ctx.t('component.commission_unresolved_items'), align: 'end' },
		{ field: 'state_label', label: label(ctx, 'orders', 'status'), cell: badge },
		{ field: 'latest_number', label: ctx.t('component.monthly_commission_statement'), cell: statement }
	]}
		<Table
			{ctx}
			layout="grid"
			of={people}
			key="monthly_commission"
			columns={peopleColumns}
			on_open={(row) => {
				if (row.latest_statement) open_record('commission_statements', row.latest_statement);
			}}
			toolbar={{
				title: ctx.t('component.commission'),
				description: false,
				new: false,
				controls,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('component.export_xlsx'),
						run: () => downloadXlsx('commission', day.today, peopleColumns, people)
					}
				]
			}}
		/>
	{:else}
		{@const lineColumns: readonly Col<(typeof lines)[number]>[] = [
		{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
		{ field: 'number', label: ctx.t('models.orders.singular'), cell: orderCell },
		{ field: 'product', label: ctx.t('reports.sales.product') },
		{ field: 'quantity', label: label(ctx, 'orders', 'quantity'), kind: { kind: 'decimal', scale: 3 }, align: 'end' },
		{
			field: 'basis_quantity',
			label: ctx.t('reports.commission.basis_quantity'),
			kind: { kind: 'decimal', scale: 3, optional: true },
			align: 'end'
		},
		{ field: 'basis_unit', label: ctx.t('reports.sales.unit') },
		{
			field: 'spread',
			label: ctx.t('reports.commission.spread'),
			kind: { kind: 'decimal', scale: 4, optional: true },
			align: 'end'
		},
		{ field: 'amount', label: label(ctx, 'orders', 'amount'), kind: moneyKind, align: 'end' },
		{ field: 'reason_label', label: label(ctx, 'orders', 'status'), cell: badge }
	]}
		<Table
			{ctx}
			layout="grid"
			of={lines}
			key="commission_lines"
			columns={lineColumns}
			toolbar={{
				title: ctx.t('component.commission'),
				description: false,
				new: false,
				controls,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('component.export_xlsx'),
						run: () => downloadXlsx('commission-lines', day.today, lineColumns, lines)
					}
				]
			}}
		/>
	{/if}
	{#if selection && board?.some((row) => row.calculation_hash === selection?.calculation_hash && ['unacknowledged', 'changed'].includes(row.state))}
		<Dialog.Root
			open
			on_open_change={(open) => {
				if (!open) selection = null;
			}}
			><Dialog.Content
				><Dialog.Title>{ctx.t('component.monthly_commission_statement')}</Dialog.Title>
				<p>
					{selection.owner_name} · {selection.period.slice(0, 7)} · <Show
						{ctx}
						kind={{ kind: 'money', currency: 'currency' }}
						value={selection.amount}
						row={selection}
					/>
				</p>
				<Form
					{ctx}
					of="commission_statements"
					mode="create"
					values={{
						owner: selection.owner,
						period: selection.period,
						currency: selection.currency,
						calculation_hash: selection.calculation_hash
					}}
					fields={[]}
					submit={ctx.t('component.commission_acknowledge')}
					on_outcome={() => (selection = null)}
				/>
			</Dialog.Content></Dialog.Root
		>
	{/if}
</Stack>
