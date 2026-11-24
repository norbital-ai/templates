<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Icon, Input, Label, Surface, type UiContext } from '@norbital-ai/ui';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { BigDecimal } from 'effect';
	import { moneyStr, toDecimal } from '../../../lib/commercial.js';

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

	const uid = $props.id();
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
		<Scroll axis="x" name={t('priced_lines.label')}>
			<table class="w-full text-left text-body">
				<thead>
					<tr class="border-b border-border text-micro text-muted-foreground">
						<th class="py-1.5 pr-3">{t('commercial.col_code')}</th>
						<th class="py-1.5 pr-3">{t('commercial.col_item')}</th>
						<th class="py-1.5 pr-3 text-right">{t('priced_lines.col_qty')}</th>
						<th class="py-1.5 pr-3 text-right">{t('priced_lines.col_rate')}</th>
						<th class="py-1.5 text-right">{t('priced_lines.col_amount')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each lines as line, idx ((line.code ?? '') + line.description + idx)}
						<tr>
							<td class="py-1.5 pr-3 font-mono text-micro">
								{line.code ?? t('component.no_value')}
							</td>
							<td class="py-1.5 pr-3">{line.description}</td>
							<td class="py-1.5 pr-3 text-right tabular-nums">
								{line.unit ? `${line.qty} ${line.unit}` : line.qty}
							</td>
							<td class="py-1.5 pr-3 text-right tabular-nums">{line.unit_rate}</td>
							<td class="py-1.5 text-right text-label tabular-nums">{line.amount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	{/if}
{:else}
	<Stack gap="sm">
		{#each lines as line, idx (idx)}
			<Surface tone="subtle" padding="sm" radius="control">
				<Stack gap="sm">
					<Grid minimum="card" gap="sm">
						<Stack gap="xs">
							<Label for={`${uid}-pl-code-${idx}`}>{t('commercial.col_code')}</Label>
							<Input
								id={`${uid}-pl-code-${idx}`}
								value={line.code ?? ''}
								disabled={view.disabled}
								oninput={(e) => updateLine(idx, { code: e.currentTarget.value || null })}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${uid}-pl-desc-${idx}`}>{t('commercial.col_item')}</Label>
							<Input
								id={`${uid}-pl-desc-${idx}`}
								value={line.description}
								disabled={view.disabled}
								oninput={(e) => updateLine(idx, { description: e.currentTarget.value })}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${uid}-pl-unit-${idx}`}>{t('priced_lines.col_unit')}</Label>
							<Input
								id={`${uid}-pl-unit-${idx}`}
								value={line.unit ?? ''}
								disabled={view.disabled}
								oninput={(e) => updateLine(idx, { unit: e.currentTarget.value || null })}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${uid}-pl-qty-${idx}`}>{t('priced_lines.col_qty')}</Label>
							<Input
								id={`${uid}-pl-qty-${idx}`}
								value={line.qty}
								disabled={view.disabled}
								oninput={(e) => updateLine(idx, { qty: e.currentTarget.value })}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${uid}-pl-rate-${idx}`}>{t('priced_lines.col_rate')}</Label>
							<Input
								id={`${uid}-pl-rate-${idx}`}
								value={line.unit_rate}
								disabled={view.disabled}
								oninput={(e) => updateLine(idx, { unit_rate: e.currentTarget.value })}
							/>
						</Stack>
					</Grid>
					<Inline gap="sm" align="center" justify="between">
						<span class="text-sm font-medium tabular-nums text-muted-foreground">
							{t('priced_lines.col_amount')}: {line.amount}
						</span>
						<Button
							size="icon"
							variant="ghost"
							disabled={view.disabled}
							hint={t('priced_lines.remove_line')}
							onclick={() => removeLine(idx)}
						>
							<Icon name="lucide:trash-2" class="size-4" />
						</Button>
					</Inline>
				</Stack>
			</Surface>
		{/each}
		<div>
			<Button variant="outline" disabled={view.disabled} onclick={addLine}>
				<Icon name="lucide:plus" class="size-3.5" />
				{t('priced_lines.add_line')}
			</Button>
		</div>
	</Stack>
{/if}
