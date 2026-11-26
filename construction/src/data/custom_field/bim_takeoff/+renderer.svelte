<script lang="ts">
	/**
	 * Always-live quantified BIM BOQ table with roving-focus discipline filter, search,
	 * inline BigDecimal editing (`measured_qty`, `waste_factor_pct`, `unit_rate`), and bulk %
	 * rate adjustment — zero mode switches and zero layout shifts.
	 */
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, Icon, Input, type UiContext } from '@norbital-ai/ui';
	import { Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
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
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (
		key: Parameters<PageContext['t']>[0],
		vars?: Record<string, string | number>
	): string => {
		if (!ctx.t) return key;
		return vars ? ctx.t(key, vars) : ctx.t(key);
	};

	const rows = $derived<readonly BimTakeoffLine[]>(view.value ?? []);
	const HUNDRED = BigDecimal.fromBigInt(100n);
	const ONE = BigDecimal.fromBigInt(1n);
	const ZERO = BigDecimal.fromBigInt(0n);

	let search = $state('');
	let disciplineFilter = $state<string>('all');
	let bulkPctInput = $state('');

	const disciplineOptions = $derived(
		['all', ...[...new Set(rows.map((r) => r.discipline).filter(Boolean))].sort()].map((disc) => ({
			value: disc,
			label: disc === 'all' ? t('timeline.filter_all') : disc.toUpperCase()
		}))
	);

	const indexedVisible = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return rows
			.map((row, index) => ({ row, index }))
			.filter(({ row }) => {
				if (disciplineFilter !== 'all' && row.discipline !== disciplineFilter) return false;
				if (!q) return true;
				return [
					row.matrix_code ?? '',
					row.classification,
					row.ifc_class,
					row.storey,
					row.discipline,
					row.match_reason ?? ''
				]
					.join(' ')
					.toLowerCase()
					.includes(q);
			});
	});

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
		const visibleIdx = new Set(indexedVisible.map((x) => x.index));
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
		'border-transparent bg-transparent text-right font-mono text-xs hover:border-input focus:border-input focus:bg-background disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:opacity-100';
</script>

{#if rows.length === 0}
	<span class="text-sm text-muted-foreground">{t('bim_costing.empty_takeoff')}</span>
{:else}
	<Stack gap="sm">
		<Cluster align="center" justify="between" gap="sm">
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
			<Cluster gap="xs" align="center">
				{#if view.mode === 'edit'}
					<Inline gap="xs" align="center">
						<Input
							bind:value={bulkPctInput}
							type="number"
							disabled={view.disabled}
							placeholder={t('bim_costing.bulk_pct_placeholder')}
							aria-label={t('bim_costing.bulk_adjust_rate')}
							class="font-mono text-xs"
						/>
						<Button
							variant="outline"
							disabled={view.disabled ||
								!bulkPctInput.trim() ||
								!Number.isFinite(Number(bulkPctInput))}
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
				<Input
					bind:value={search}
					type="search"
					placeholder={t('bim_costing.search_boq')}
					aria-label={t('bim_costing.search_boq')}
					class="text-xs"
				/>
			</Cluster>
		</Cluster>

		<Scroll axis="x" name={t('bim_costing.takeoff_table')}>
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-border text-micro text-muted-foreground">
						<th class="py-1.5 pr-3 whitespace-nowrap">{t('bim_costing.col_matrix')}</th>
						<th class="py-1.5 pr-3">{t('bim_costing.col_classification')}</th>
						<th class="py-1.5 pr-3 whitespace-nowrap">{t('bim_costing.col_storey')}</th>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_elements')}</th
						>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_measured')}</th
						>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_waste')}</th>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_rate')}</th>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_amount')}</th>
						<th class="py-1.5 pr-3 text-right whitespace-nowrap">{t('bim_costing.col_carbon')}</th>
						<th class="py-1.5 whitespace-nowrap">{t('bim_costing.col_match')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each indexedVisible as { row, index } (row.asset_key)}
						<tr>
							<td class="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
								{row.matrix_code ?? '—'}
							</td>
							<td class="py-1.5 pr-3 min-w-52">
								<div class="text-label">{row.classification}</div>
								<div class="font-mono text-micro text-muted-foreground">{row.ifc_class}</div>
								{#if row.match_reason}
									<div class="text-micro text-muted-foreground">{row.match_reason}</div>
								{/if}
							</td>
							<td class="py-1.5 pr-3 whitespace-nowrap">{row.storey}</td>
							<td class="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
								{row.element_count}
							</td>
							<td class="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
								{#if view.mode === 'edit'}
									<Inline gap="xs" align="center" justify="end">
										<Input
											aria-label={t('bim_costing.col_measured')}
											value={row.measured_qty}
											disabled={view.disabled}
											class={inlineCellInputClass}
											oninput={(e) => updateField(index, 'measured_qty', e.currentTarget.value)}
										/>
										<span class="text-micro text-muted-foreground">{row.unit}</span>
									</Inline>
								{:else}
									{`${row.measured_qty} ${row.unit}`}
								{/if}
							</td>
							<td class="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
								{#if view.mode === 'edit'}
									<Inline gap="xs" align="center" justify="end">
										<Input
											aria-label={t('bim_costing.col_waste')}
											value={row.waste_factor_pct}
											disabled={view.disabled}
											class={inlineCellInputClass}
											oninput={(e) => updateField(index, 'waste_factor_pct', e.currentTarget.value)}
										/>
										<span class="text-micro text-muted-foreground">{'%'}</span>
									</Inline>
								{:else}
									{`${row.waste_factor_pct}%`}
								{/if}
							</td>
							<td class="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
								{#if view.mode === 'edit'}
									<Input
										aria-label={t('bim_costing.col_rate')}
										value={row.unit_rate}
										disabled={view.disabled}
										class={inlineCellInputClass}
										oninput={(e) => updateField(index, 'unit_rate', e.currentTarget.value)}
									/>
								{:else}
									{row.unit_rate}
								{/if}
							</td>
							<td class="py-1.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
								{row.amount}
							</td>
							<td class="py-1.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
								{row.carbon}
							</td>
							<td class="py-1.5 whitespace-nowrap">
								<Badge variant={statusTone(row)} class="whitespace-nowrap">{statusLabel(row)}</Badge
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Stack>
{/if}
