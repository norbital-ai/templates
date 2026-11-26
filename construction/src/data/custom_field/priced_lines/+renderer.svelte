<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, type UiContext } from '@norbital-ai/ui';
	import { Inline, Scroll } from '@norbital-ai/ui/layout';
	import CatalogLinesEditor from '../../../lib/CatalogLinesEditor.svelte';
	import type { NormalizedPricedLine } from '../../../services/commercial/lines.js';

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'priced_lines'>;
		ctx: UiContext & Partial<Pick<PageContext, 'query' | 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const lines = $derived<readonly NormalizedPricedLine[]>(view.value ?? []);
	const editorCtx = $derived(ctx.query && ctx.t ? { query: ctx.query, t: ctx.t } : null);
</script>

{#if view.mode === 'show' || editorCtx === null}
	{#if lines.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Scroll axis="x" name={t('priced_lines.label')}>
			<table class="w-full text-left text-body">
				<thead>
					<tr class="border-b border-border text-micro text-muted-foreground">
						<th class="py-1.5 pr-3">{t('commercial.col_code')}</th>
						<th class="py-1.5 pr-3">{t('priced_lines.col_source')}</th>
						<th class="py-1.5 pr-3">{t('commercial.col_item')}</th>
						<th class="py-1.5 pr-3 text-right">{t('priced_lines.col_qty')}</th>
						<th class="py-1.5 pr-3 text-right">{t('priced_lines.col_rate')}</th>
						<th class="py-1.5 text-right">{t('priced_lines.col_amount')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each lines as line, idx ((line.bim_asset_key ?? line.code) + ':' + idx)}
						<tr>
							<td class="py-1.5 pr-3 font-mono text-micro">
								{line.code}
							</td>
							<td class="py-1.5 pr-3">
								<Inline gap="xs" align="center">
									<Badge variant="outline">
										{line.source === 'adhoc_catalog'
											? t('priced_lines.badge_catalog')
											: t('priced_lines.badge_bim')}
									</Badge>
									{#if line.storey}
										<span class="text-micro text-muted-foreground">{line.storey}</span>
									{/if}
								</Inline>
							</td>
							<td class="py-1.5 pr-3">{line.description}</td>
							<td class="py-1.5 pr-3 text-right tabular-nums">
								{`${line.qty} ${line.unit}`}
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
	<CatalogLinesEditor
		ctx={editorCtx}
		value={lines}
		disabled={view.disabled}
		onChange={(next) => {
			if (view.mode === 'edit') view.on_change(next ? [...next] : null);
		}}
	/>
{/if}
