<script lang="ts">
	// Commission: what each salesperson earns for the month from its shipments and returns, line by line, what is
	// still pending and why, and whether the month's statement is approved.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal, Effect } from 'effect';
	import {
		Badge,
		Dialog,
		EmptyState,
		Form,
		RowMenu,
		Show,
		Table,
		TableSkeleton,
		Tabs,
		label,
		open_record,
		type Col,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { Bound } from '@norbital-ai/ui/layout';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { boardRead, completeCommissionBoard, monthOf } from '../../../lib/monthly-commission.js';
	import { displayUnit } from '../../../lib/unit-display.js';
	import { downloadXlsx } from '../../../lib/xlsx.js';

	let { ctx, period: month }: { ctx: PageContext; period: string } = $props();
	const day = ctx.clock('day');
	const period = $derived(monthOf(month));
	const request = $derived(
		boardRead(period, ctx.catalog?.source_sales_lines?.output === 'commercial', undefined, 10_000)
	);
	const first = $derived(ctx.query(request));
	type Board = Effect.Success<ReturnType<typeof completeCommissionBoard>>;
	const boardState = observe_once(() => {
		const answer = first.current;
		return answer ? completeCommissionBoard(ctx, request, answer, period) : null;
	});
	const board = $derived(boardState.current ?? null);
	const failed = $derived(
		boardState.error === undefined
			? null
			: boardState.error instanceof Error
				? boardState.error.message
				: String(boardState.error)
	);
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
							`${BigDecimal.format(BigDecimal.sumAll(lines.map((line) => BigDecimal.fromStringUnsafe(line.basis_quantity ?? '0'))))} ${displayUnit(unit, ctx.locale)}`
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
				basis_unit_display: displayUnit(line.basis_unit, ctx.locale),
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
{#snippet approveAction(row: (typeof people)[number])}
	{#if ctx.catalog?.commission_statements?.create && ['unacknowledged', 'changed'].includes(row.state)}
		<RowMenu
			{ctx}
			actions={[
				{
					label: ctx.t('component.commission_acknowledge'),
					run: () => {
						selection = row;
					}
				}
			]}
		/>
	{/if}
{/snippet}
{#snippet salespeopleTab()}
	{@const peopleColumns: readonly Col<(typeof people)[number]>[] = [
		{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
		{
			field: 'order_count',
			label: label(ctx, 'commission_statements', 'order_count'),
			kind: { kind: 'int' },
			align: 'end'
		},
		{ field: 'basis_quantity', label: ctx.t('reports.commission.basis_quantity'), align: 'end' },
		{ field: 'amount', label: label(ctx, 'orders', 'amount'), kind: moneyKind, align: 'end' },
		{
			field: 'latest_amount',
			label: ctx.t('component.commission_previous'),
			kind: moneyKind,
			align: 'end'
		},
		{
			field: 'unresolved_lines',
			label: ctx.t('component.commission_unresolved_items'),
			kind: { kind: 'int' },
			align: 'end'
		},
		{ field: 'state_label', label: label(ctx, 'orders', 'status'), cell: badge },
		{ field: 'latest_number', label: ctx.t('component.monthly_commission_statement') }
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
		{...ctx.catalog?.commission_statements?.create ? { row_trailing: approveAction } : {}}
		toolbar={{
			title: ctx.t('component.commission'),
			description: false,
			new: false,
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('commission', day.today, peopleColumns, people)
				}
			]
		}}
	/>
{/snippet}
{#snippet linesTab()}
	{@const lineColumns: readonly Col<(typeof lines)[number]>[] = [
		{ field: 'owner_name', label: label(ctx, 'orders', 'owner_name') },
		{ field: 'number', label: ctx.t('models.orders.singular') },
		{ field: 'product', label: ctx.t('reports.sales.product') },
		{
			field: 'basis_quantity',
			label: ctx.t('reports.commission.basis_quantity'),
			kind: { kind: 'decimal', scale: 3, optional: true },
			align: 'end'
		},
		{ field: 'basis_unit_display', label: ctx.t('reports.sales.unit') },
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
		on_open={(row) => open_record('orders', row.order)}
		toolbar={{
			title: ctx.t('component.commission'),
			description: false,
			new: false,
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.export_xlsx'),
					run: () => downloadXlsx('commission-lines', day.today, lineColumns, lines)
				}
			]
		}}
	/>
{/snippet}

<Bound size="fill" min_height="18rem">
	{#if failed !== null || first.error}<EmptyState
			tone="danger"
			title={failed ?? first.error?.message ?? ''}
		/>
	{:else if !board}
		<div aria-busy="true" aria-label={ctx.t('component.reports_loading')}><TableSkeleton /></div>
	{:else}
		<Tabs
			level={2}
			value={view}
			on_value_change={(next) => (view = next === 'lines' ? 'lines' : 'salespeople')}
			tabs={[
				{
					name: 'salespeople',
					title: ctx.t('reports.commission.salespeople'),
					body: salespeopleTab
				},
				{ name: 'lines', title: ctx.t('reports.commission.lines'), body: linesTab }
			]}
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
</Bound>
