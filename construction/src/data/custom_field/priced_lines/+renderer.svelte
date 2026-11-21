<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Icon, Input, type UiContext } from '@norbital-ai/ui';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { BigDecimal } from 'effect';
	import { moneyStr, toDecimal } from '../../../lib/claims.js';

	type Line = {
		readonly code?: string | null;
		readonly description: string;
		readonly unit?: string | null;
		readonly qty: string;
		readonly unit_rate: string;
		readonly amount: string;
	};

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'priced_lines'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const lines = $derived<readonly Line[]>(view.value ?? []);

	function emit(next: readonly Line[]): void {
		if (view.mode !== 'edit') return;
		view.on_change(next.length === 0 ? null : [...next]);
	}

	function addLine(): void {
		emit([
			...lines,
			{ code: null, description: '', unit: 'ls', qty: '1', unit_rate: '0.00', amount: '0.00' }
		]);
	}

	function removeLine(index: number): void {
		emit(lines.filter((_, i) => i !== index));
	}

	function updateLine(index: number, patch: Partial<Line>): void {
		emit(
			lines.map((line, i) => {
				if (i !== index) return line;
				const next = { ...line, ...patch };
				const amount = moneyStr(
					BigDecimal.multiply(toDecimal(next.qty), toDecimal(next.unit_rate))
				);
				return { ...next, amount };
			})
		);
	}
</script>

{#if view.mode === 'show'}
	{#if lines.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Scroll axis="x" name={t('quotes.priced_lines')}>
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-border text-micro text-muted-foreground">
						<th class="py-1.5 pr-3">{t('commercial.col_code')}</th>
						<th class="py-1.5 pr-3">{t('commercial.col_item')}</th>
						<th class="py-1.5 pr-3 text-right">{t('quotes.col_qty')}</th>
						<th class="py-1.5 pr-3 text-right">{t('quotes.col_rate')}</th>
						<th class="py-1.5 text-right">{t('quotes.col_amount')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border/60">
					{#each lines as line, idx ((line.code ?? '') + line.description + idx)}
						<tr>
							<td class="py-1.5 pr-3 font-mono text-xs">{line.code ?? t('component.no_value')}</td>
							<td class="py-1.5 pr-3">{line.description}</td>
							<td class="py-1.5 pr-3 text-right tabular-nums">
								{line.unit ? `${line.qty} ${line.unit}` : line.qty}
							</td>
							<td class="py-1.5 pr-3 text-right tabular-nums">{line.unit_rate}</td>
							<td class="py-1.5 text-right font-medium tabular-nums">{line.amount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	{/if}
{:else}
	<Stack gap="sm">
		{#each lines as line, idx (idx)}
			<div class="rounded-md border border-border bg-muted/20 p-3">
				<Grid minimum="compact" gap="sm">
					<Input
						placeholder={t('commercial.col_code')}
						value={line.code ?? ''}
						disabled={view.disabled}
						oninput={(e) => updateLine(idx, { code: e.currentTarget.value || null })}
					/>
					<Input
						placeholder={t('commercial.col_item')}
						value={line.description}
						disabled={view.disabled}
						oninput={(e) => updateLine(idx, { description: e.currentTarget.value })}
					/>
					<Input
						placeholder={t('quotes.col_unit')}
						value={line.unit ?? ''}
						disabled={view.disabled}
						oninput={(e) => updateLine(idx, { unit: e.currentTarget.value || null })}
					/>
					<Input
						placeholder={t('quotes.col_qty')}
						value={line.qty}
						disabled={view.disabled}
						oninput={(e) => updateLine(idx, { qty: e.currentTarget.value })}
					/>
					<Inline gap="xs" align="center">
						<Input
							placeholder={t('quotes.col_rate')}
							value={line.unit_rate}
							disabled={view.disabled}
							oninput={(e) => updateLine(idx, { unit_rate: e.currentTarget.value })}
						/>
						<span class="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
							{line.amount}
						</span>
						<Button
							size="icon"
							variant="ghost"
							disabled={view.disabled}
							hint={t('quotes.remove_line')}
							onclick={() => removeLine(idx)}
						>
							<Icon name="lucide:trash-2" class="size-4" />
						</Button>
					</Inline>
				</Grid>
			</div>
		{/each}
		<div>
			<Button variant="outline" disabled={view.disabled} onclick={addLine}>
				<Icon name="lucide:plus" class="size-3.5" />
				{t('quotes.add_line')}
			</Button>
		</div>
	</Stack>
{/if}
