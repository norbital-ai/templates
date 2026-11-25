<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Input, type UiContext } from '@norbital-ai/ui';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	import { BigDecimal } from 'effect';
	import { divSafe, formatTrimmed, moneyStr, toDecimal } from '../../../lib/commercial.js';
	import type { BimTakeoffLine } from '../../../lib/bim-pipeline.js';

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
				if (row.match_method === 'rule') {
					return t('bim_costing.status_rule_matched');
				}
				return t('bim_costing.status_matched');
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

	function updateRate(index: number, nextRate: string): void {
		if (view.mode !== 'edit') return;
		const updated = rows.map((row, i) => {
			if (i !== index) return row;
			const measured = toDecimal(row.measured_qty);
			const waste = BigDecimal.max(BigDecimal.fromBigInt(0n), toDecimal(row.waste_factor_pct));
			const pricedQty = BigDecimal.multiply(measured, BigDecimal.sum(ONE, divSafe(waste, HUNDRED)));
			const rate = toDecimal(nextRate);
			const amount = BigDecimal.round(BigDecimal.multiply(pricedQty, rate), {
				scale: 2,
				mode: 'half-from-zero'
			});
			return {
				...row,
				unit_rate: nextRate,
				priced_qty: formatTrimmed(pricedQty, 3),
				amount: moneyStr(amount),
				status: 'override' as const,
				match_method: 'override' as const
			};
		});
		view.on_change(updated);
	}
</script>

{#if rows.length === 0}
	<span class="text-sm text-muted-foreground">{t('bim_costing.empty_takeoff')}</span>
{:else}
	<Stack gap="sm">
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
						<th class="py-1.5 whitespace-nowrap">{t('bim_costing.col_match')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each rows as row, idx (row.asset_key)}
						<tr>
							<td class="py-2 pr-3 font-mono text-xs whitespace-nowrap">{row.matrix_code ?? '—'}</td
							>
							<td class="py-2 pr-3 min-w-52">
								<div class="font-medium">{row.classification}</div>
								<div class="text-micro text-muted-foreground">{row.ifc_class}</div>
								{#if row.match_reason}
									<div class="text-micro text-muted-foreground">{row.match_reason}</div>
								{/if}
							</td>
							<td class="py-2 pr-3 whitespace-nowrap">{row.storey}</td>
							<td class="py-2 pr-3 text-right tabular-nums whitespace-nowrap"
								>{row.element_count}</td
							>
							<td class="py-2 pr-3 text-right tabular-nums whitespace-nowrap"
								>{row.measured_qty} {row.unit}</td
							>
							<td class="py-2 pr-3 text-right tabular-nums whitespace-nowrap"
								>{row.waste_factor_pct}%</td
							>
							<td class="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
								{#if view.mode === 'edit'}
									<Input
										aria-label={t('bim_costing.col_rate')}
										value={row.unit_rate}
										disabled={view.disabled}
										oninput={(e) => updateRate(idx, e.currentTarget.value)}
									/>
								{:else}
									{row.unit_rate}
								{/if}
							</td>
							<td class="py-2 pr-3 text-right font-medium tabular-nums whitespace-nowrap"
								>{row.amount}</td
							>
							<td class="py-2 whitespace-nowrap">
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
