<script lang="ts">
	/**
	 * Quantified BIM BOQ rendered with standardized `<Table>` (search, filter, sort, column controls,
	 * CSV export), discipline filter toggle, inline BigDecimal editing (`measured_qty`,
	 * `waste_factor_pct`, `unit_rate`), and bulk % rate adjustment.
	 */
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, Icon, Input, Table, type UiContext } from '@norbital-ai/ui';
	import { Bound, Inline, Stack } from '@norbital-ai/ui/layout';
	import { BigDecimal } from 'effect';
	import {
		divSafe,
		formatTrimmed,
		moneyStr,
		toDecimal
	} from '../../../services/commercial/decimal.js';
	import type { BimTakeoffLine } from '../../../services/bim/schema.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'bim_takeoff'>;
		ctx: UiContext & Partial<Pick<PageContext, 't' | 'query'>>;
	} = $props();

	const t = (
		key: Parameters<PageContext['t']>[0],
		vars?: Record<string, string | number>
	): string => {
		if (!ctx.t) return key;
		return vars ? ctx.t(key, vars) : ctx.t(key);
	};

	const hasShell = $derived(typeof ctx.query === 'function');
	const rows = $derived<readonly BimTakeoffLine[]>(view.value ?? []);
	const HUNDRED = BigDecimal.fromBigInt(100n);
	const ONE = BigDecimal.fromBigInt(1n);
	const ZERO = BigDecimal.fromBigInt(0n);

	let disciplineFilter = $state<string>('all');
	let bulkPctInput = $state('');

	const disciplineOptions = $derived(
		['all', ...[...new Set(rows.map((r) => r.discipline).filter(Boolean))].sort()].map((disc) => ({
			value: disc,
			label: disc === 'all' ? t('timeline.filter_all') : disc.toUpperCase()
		}))
	);

	function statusTone(row: BimTakeoffLine): 'success' | 'warning' | 'destructive' | 'info' {
		switch (row.status) {
			case 'matched':
				return row.match_method === 'ai_sys1' || row.match_method === 'ai_sys2'
					? 'info'
					: 'success';
			case 'override':
				return 'info';
			case 'rate_missing':
				return 'warning';
			default:
				return 'destructive';
		}
	}

	function statusLabel(row: BimTakeoffLine): string {
		switch (row.status) {
			case 'matched':
				if (row.match_method === 'ai_sys1' || row.match_method === 'ai_sys2') {
					const pct = row.match_confidence != null ? Math.round(row.match_confidence * 100) : 90;
					return t('bim_costing.status_ai_matched', { pct });
				}
				return row.match_method === 'rule'
					? t('bim_costing.status_rule_matched')
					: t('bim_costing.status_matched');
			case 'override':
				return t('bim_costing.status_override');
			case 'rate_missing':
				return t('bim_costing.status_rate_missing');
			default:
				return row.match_method === 'ai_sys1'
					? t('bim_costing.status_unknown_catalog')
					: t('bim_costing.status_unmatched');
		}
	}

	type TakeoffTableRow = {
		readonly id: string;
		readonly _index: number;
		readonly raw: BimTakeoffLine;
		readonly matrix_code: string;
		readonly classification: string;
		readonly ifc_class: string;
		readonly discipline: string;
		readonly storey: string;
		readonly element_count: number;
		readonly measured_qty: string;
		readonly unit: string;
		readonly waste_factor_pct: string;
		readonly unit_rate: string;
		readonly amount: string;
		readonly carbon: string;
		readonly match_status: string;
	};

	const tableRows = $derived<readonly TakeoffTableRow[]>(
		rows
			.map((row, index) => ({ row, index }))
			.filter(({ row }) => disciplineFilter === 'all' || row.discipline === disciplineFilter)
			.map(({ row, index }) => ({
				id: `${row.asset_key}:${index}`,
				_index: index,
				raw: row,
				matrix_code: row.matrix_code ?? '—',
				classification: row.classification,
				ifc_class: row.ifc_class,
				discipline: row.discipline,
				storey: row.storey,
				element_count: row.element_count,
				measured_qty: row.measured_qty,
				unit: row.unit,
				waste_factor_pct: row.waste_factor_pct,
				unit_rate: row.unit_rate,
				amount: row.amount,
				carbon: row.carbon,
				match_status: statusLabel(row)
			}))
	);

	function recomputeLine(
		row: BimTakeoffLine,
		patch: Partial<Pick<BimTakeoffLine, 'measured_qty' | 'waste_factor_pct' | 'unit_rate'>>
	): BimTakeoffLine {
		const nextMeasuredRaw = patch.measured_qty ?? row.measured_qty;
		const nextWasteRaw = patch.waste_factor_pct ?? row.waste_factor_pct;
		const nextRateRaw = patch.unit_rate ?? row.unit_rate;

		const measured = BigDecimal.max(ZERO, toDecimal(nextMeasuredRaw));
		const waste = BigDecimal.max(ZERO, toDecimal(nextWasteRaw));
		const pricedQty = BigDecimal.multiply(measured, BigDecimal.sum(ONE, divSafe(waste, HUNDRED)));
		const rate = BigDecimal.max(ZERO, toDecimal(nextRateRaw));
		const amount = BigDecimal.round(BigDecimal.multiply(pricedQty, rate), {
			scale: 2,
			mode: 'half-from-zero'
		});
		const carbon = BigDecimal.multiply(
			pricedQty,
			BigDecimal.max(ZERO, toDecimal(row.carbon_factor))
		);
		return {
			...row,
			measured_qty: nextMeasuredRaw,
			waste_factor_pct: nextWasteRaw,
			unit_rate: nextRateRaw,
			priced_qty: formatTrimmed(pricedQty, 3),
			amount: moneyStr(amount),
			carbon: formatTrimmed(carbon, 2),
			status: 'override' as const,
			match_method: 'override' as const
		};
	}

	function updateField(
		index: number,
		field: 'measured_qty' | 'waste_factor_pct' | 'unit_rate',
		nextValue: string
	): void {
		if (view.mode !== 'edit') return;
		view.on_change(
			rows.map((row, i) => (i === index ? recomputeLine(row, { [field]: nextValue }) : row))
		);
	}

	function applyBulkRateFactor(pctDelta: number): void {
		if (view.mode !== 'edit' || !Number.isFinite(pctDelta) || pctDelta === 0) return;
		const visibleIdx = new Set(tableRows.map((x) => x._index));
		const factor = BigDecimal.sum(ONE, divSafe(toDecimal(pctDelta), HUNDRED));
		view.on_change(
			rows.map((row, i) => {
				if (!visibleIdx.has(i)) return row;
				const curRate = toDecimal(row.unit_rate);
				if (!BigDecimal.isPositive(curRate)) return row;
				const nextRate = moneyStr(
					BigDecimal.round(BigDecimal.multiply(curRate, factor), {
						scale: 2,
						mode: 'half-from-zero'
					})
				);
				return recomputeLine(row, { unit_rate: nextRate });
			})
		);
	}

	const inlineCellInputClass =
		'h-7 border-transparent bg-transparent text-right font-mono text-xs hover:border-input focus:border-input focus:bg-background disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:opacity-100';
</script>

{#snippet disciplineControls()}
	<SegmentedToggle
		options={disciplineOptions}
		value={disciplineFilter}
		onChange={(next) => (disciplineFilter = next)}
		label={t('models.item_matrix.fields.discipline')}
		control={{
			id: 'construction:bim-boq-discipline',
			label: t('models.item_matrix.fields.discipline')
		}}
	/>
{/snippet}

{#snippet bulkRateTrailing()}
	{#if view.mode === 'edit'}
		<Inline gap="xs" align="center">
			<div class="w-20">
				<Input
					bind:value={bulkPctInput}
					type="number"
					disabled={view.disabled}
					placeholder={t('bim_costing.bulk_pct_placeholder')}
					aria-label={t('bim_costing.bulk_adjust_rate')}
					class="font-mono text-xs"
				/>
			</div>
			<Button
				variant="outline"
				disabled={view.disabled || !bulkPctInput.trim() || !Number.isFinite(Number(bulkPctInput))}
				onclick={() => {
					applyBulkRateFactor(Number(bulkPctInput));
					bulkPctInput = '';
				}}
			>
				<Icon name="lucide:percent" class="size-3.5" />
				{t('bim_costing.bulk_adjust_rate')}
			</Button>
		</Inline>
	{/if}
{/snippet}

{#snippet matrixCodeCell({ row }: { row: TakeoffTableRow })}
	<span class="font-mono text-xs">{row.matrix_code}</span>
{/snippet}

{#snippet classificationCell({ row }: { row: TakeoffTableRow })}
	<div
		class="flex min-w-0 items-center gap-1.5"
		title={[row.classification, row.ifc_class, row.raw.match_reason ?? '']
			.filter(Boolean)
			.join(' · ')}
	>
		<span class="min-w-0 truncate text-label text-foreground">{row.classification}</span>
		<span class="shrink-0 font-mono text-tiny text-muted-foreground">{row.ifc_class}</span>
	</div>
{/snippet}

{#snippet measuredCell({ row }: { row: TakeoffTableRow })}
	{#if view.mode === 'edit'}
		<Inline gap="xs" align="center" justify="end">
			<Input
				aria-label={t('bim_costing.col_measured')}
				value={row.measured_qty}
				disabled={view.disabled}
				class={inlineCellInputClass}
				oninput={(e) => updateField(row._index, 'measured_qty', e.currentTarget.value)}
			/>
			<span class="shrink-0 text-micro text-muted-foreground">{row.unit}</span>
		</Inline>
	{:else}
		<span class="font-mono tabular-nums">{`${row.measured_qty} ${row.unit}`}</span>
	{/if}
{/snippet}

{#snippet wasteCell({ row }: { row: TakeoffTableRow })}
	{#if view.mode === 'edit'}
		<Inline gap="xs" align="center" justify="end">
			<Input
				aria-label={t('bim_costing.col_waste')}
				value={row.waste_factor_pct}
				disabled={view.disabled}
				class={inlineCellInputClass}
				oninput={(e) => updateField(row._index, 'waste_factor_pct', e.currentTarget.value)}
			/>
			<span class="shrink-0 text-micro text-muted-foreground">{'%'}</span>
		</Inline>
	{:else}
		<span class="font-mono tabular-nums">{`${row.waste_factor_pct}%`}</span>
	{/if}
{/snippet}

{#snippet rateCell({ row }: { row: TakeoffTableRow })}
	{#if view.mode === 'edit'}
		<Input
			aria-label={t('bim_costing.col_rate')}
			value={row.unit_rate}
			disabled={view.disabled}
			class={inlineCellInputClass}
			oninput={(e) => updateField(row._index, 'unit_rate', e.currentTarget.value)}
		/>
	{:else}
		<span class="font-mono tabular-nums">{row.unit_rate}</span>
	{/if}
{/snippet}

{#snippet matchCell({ row }: { row: TakeoffTableRow })}
	<Badge variant={statusTone(row.raw)} class="whitespace-nowrap">{row.match_status}</Badge>
{/snippet}

{#if rows.length === 0}
	<span class="text-sm text-muted-foreground">{t('bim_costing.empty_takeoff')}</span>
{:else if hasShell}
	<Bound size="viewport">
		<Table
			{ctx}
			of={tableRows}
			key="bim:takeoff"
			layout="grid"
			toolbar={{
				title: t('bim_costing.takeoff_table'),
				controls: disciplineControls,
				trailing: bulkRateTrailing,
				export: true,
				select: false,
				new: false
			}}
			columns={[
				{
					field: 'matrix_code',
					label: t('bim_costing.col_matrix'),
					width: 124,
					cell: matrixCodeCell
				},
				{
					field: 'classification',
					label: t('bim_costing.col_classification'),
					width: 280,
					cell: classificationCell
				},
				{ field: 'storey', label: t('bim_costing.col_storey'), width: 92 },
				{
					field: 'element_count',
					label: t('bim_costing.col_elements'),
					kind: { kind: 'int' },
					width: 72,
					align: 'end'
				},
				{
					field: 'measured_qty',
					label: t('bim_costing.col_measured'),
					width: 120,
					align: 'end',
					cell: measuredCell
				},
				{
					field: 'waste_factor_pct',
					label: t('bim_costing.col_waste'),
					width: 88,
					align: 'end',
					cell: wasteCell
				},
				{
					field: 'unit_rate',
					label: t('bim_costing.col_rate'),
					width: 112,
					align: 'end',
					cell: rateCell
				},
				{
					field: 'amount',
					label: t('bim_costing.col_amount'),
					kind: { kind: 'decimal', scale: 2 },
					width: 112,
					align: 'end'
				},
				{
					field: 'carbon',
					label: t('bim_costing.col_carbon'),
					kind: { kind: 'decimal', scale: 2 },
					width: 124,
					align: 'end'
				},
				{
					field: 'match_status',
					label: t('bim_costing.col_match'),
					width: 112,
					cell: matchCell
				}
			]}
		/>
	</Bound>
{:else}
	<Stack gap="sm">
		<Table
			{ctx}
			of={tableRows}
			controlled
			embedded
			layout="grid"
			columns={[
				{
					field: 'matrix_code',
					label: t('bim_costing.col_matrix'),
					width: 124,
					cell: matrixCodeCell
				},
				{
					field: 'classification',
					label: t('bim_costing.col_classification'),
					width: 280,
					cell: classificationCell
				},
				{ field: 'storey', label: t('bim_costing.col_storey'), width: 92 },
				{
					field: 'element_count',
					label: t('bim_costing.col_elements'),
					kind: { kind: 'int' },
					width: 72,
					align: 'end'
				},
				{
					field: 'measured_qty',
					label: t('bim_costing.col_measured'),
					width: 120,
					align: 'end',
					cell: measuredCell
				},
				{
					field: 'waste_factor_pct',
					label: t('bim_costing.col_waste'),
					width: 88,
					align: 'end',
					cell: wasteCell
				},
				{
					field: 'unit_rate',
					label: t('bim_costing.col_rate'),
					width: 112,
					align: 'end',
					cell: rateCell
				},
				{
					field: 'amount',
					label: t('bim_costing.col_amount'),
					kind: { kind: 'decimal', scale: 2 },
					width: 112,
					align: 'end'
				},
				{
					field: 'carbon',
					label: t('bim_costing.col_carbon'),
					kind: { kind: 'decimal', scale: 2 },
					width: 124,
					align: 'end'
				},
				{
					field: 'match_status',
					label: t('bim_costing.col_match'),
					width: 112,
					cell: matchCell
				}
			]}
		/>
	</Stack>
{/if}
