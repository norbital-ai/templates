<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Input, type UiContext } from '@norbital-ai/ui';
	import { Grid, Scroll, Stack } from '@norbital-ai/ui/layout';

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'claim_valuation'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const val = $derived(view.value);

	function patch(
		next: Partial<{
			gross_work_done: string;
			approved_variations_amount: string;
			retention_held: string;
			previous_certified_amount: string;
		}>
	): void {
		if (view.mode !== 'edit') return;
		const base = val ?? {
			gross_work_done: '0.00',
			approved_variations_amount: '0.00',
			retention_held: '0.00',
			previous_certified_amount: '0.00',
			lines: null
		};
		view.on_change({ ...base, ...next });
	}
</script>

{#if view.mode === 'show'}
	{#if !val}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Stack gap="sm">
			<Grid minimum="compact" gap="sm" class="text-sm">
				<Stack gap="xs">
					<span class="text-meta">{t('commercial.gross_work_done')}</span>
					<span class="font-medium tabular-nums">{val.gross_work_done}</span>
				</Stack>
				<Stack gap="xs">
					<span class="text-meta">{t('commercial.approved_variations')}</span>
					<span class="font-medium tabular-nums">{val.approved_variations_amount}</span>
				</Stack>
				<Stack gap="xs">
					<span class="text-meta">{t('commercial.retention_held')}</span>
					<span class="font-medium tabular-nums">{val.retention_held}</span>
				</Stack>
				<Stack gap="xs">
					<span class="text-meta">{t('commercial.previous_certified')}</span>
					<span class="font-medium tabular-nums">{val.previous_certified_amount}</span>
				</Stack>
			</Grid>
			{#if val.lines && val.lines.length > 0}
				<Scroll axis="x" name={t('section.valuation_breakdown')}>
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-border text-micro text-muted-foreground">
								<th class="py-1.5 pr-3">{t('commercial.col_code')}</th>
								<th class="py-1.5 pr-3">{t('commercial.col_item')}</th>
								<th class="py-1.5 pr-3 text-right">{t('commercial.col_contract')}</th>
								<th class="py-1.5 pr-3 text-right">{t('commercial.col_progress')}</th>
								<th class="py-1.5 text-right">{t('commercial.col_gross')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/60">
							{#each val.lines as line, idx (line.code + idx)}
								<tr>
									<td class="py-1.5 pr-3 font-mono text-xs">{line.code}</td>
									<td class="py-1.5 pr-3">{line.description}</td>
									<td class="py-1.5 pr-3 text-right tabular-nums">{line.contract_amount}</td>
									<td class="py-1.5 pr-3 text-right tabular-nums">{`${line.progress_pct}%`}</td>
									<td class="py-1.5 text-right font-medium tabular-nums">{line.gross_value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Scroll>
			{/if}
		</Stack>
	{/if}
{:else}
	<Grid minimum="compact" gap="sm">
		<Stack gap="xs">
			<span class="text-meta">{t('commercial.gross_work_done')}</span>
			<Input
				value={val?.gross_work_done ?? '0.00'}
				disabled={view.disabled}
				oninput={(e) => patch({ gross_work_done: e.currentTarget.value })}
			/>
		</Stack>
		<Stack gap="xs">
			<span class="text-meta">{t('commercial.approved_variations')}</span>
			<Input
				value={val?.approved_variations_amount ?? '0.00'}
				disabled={view.disabled}
				oninput={(e) => patch({ approved_variations_amount: e.currentTarget.value })}
			/>
		</Stack>
		<Stack gap="xs">
			<span class="text-meta">{t('commercial.retention_held')}</span>
			<Input
				value={val?.retention_held ?? '0.00'}
				disabled={view.disabled}
				oninput={(e) => patch({ retention_held: e.currentTarget.value })}
			/>
		</Stack>
		<Stack gap="xs">
			<span class="text-meta">{t('commercial.previous_certified')}</span>
			<Input
				value={val?.previous_certified_amount ?? '0.00'}
				disabled={view.disabled}
				oninput={(e) => patch({ previous_certified_amount: e.currentTarget.value })}
			/>
		</Stack>
	</Grid>
{/if}
