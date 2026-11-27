<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Table, type UiContext } from '@norbital-ai/ui';
	import { Bound, Inline } from '@norbital-ai/ui/layout';
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
	const hasShell = $derived(typeof ctx.query === 'function');
	const editorCtx = $derived(ctx.query && ctx.t ? { query: ctx.query, t: ctx.t } : null);

	type PricedLineRow = {
		readonly id: string;
		readonly line: NormalizedPricedLine;
		readonly code: string;
		readonly source_label: string;
		readonly description: string;
		readonly qty_display: string;
		readonly unit_rate: string;
		readonly amount: string;
	};

	const tableRows = $derived<readonly PricedLineRow[]>(
		lines.map((line, idx) => ({
			id: `${line.bim_asset_key ?? line.code}:${idx}`,
			line,
			code: line.code,
			source_label:
				line.source === 'adhoc_catalog'
					? t('priced_lines.badge_catalog')
					: t('priced_lines.badge_bim'),
			description: line.description,
			qty_display: `${line.qty} ${line.unit}`,
			unit_rate: line.unit_rate,
			amount: line.amount
		}))
	);
</script>

{#snippet sourceCell({ row }: { row: PricedLineRow })}
	<Inline gap="xs" align="center">
		<Badge variant="outline">{row.source_label}</Badge>
		{#if row.line.storey}
			<span class="text-micro text-muted-foreground">{row.line.storey}</span>
		{/if}
	</Inline>
{/snippet}

{#if view.mode === 'show' || editorCtx === null}
	{#if lines.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else if hasShell}
		<Bound size="viewport">
			<Table
				{ctx}
				of={tableRows}
				key="construction:priced-lines"
				layout="grid"
				toolbar={{ title: false, export: true, select: false, new: false }}
				columns={[
					{ field: 'code', label: t('commercial.col_code'), width: 120 },
					{
						field: 'source_label',
						label: t('priced_lines.col_source'),
						width: 140,
						cell: sourceCell
					},
					{ field: 'description', label: t('commercial.col_item'), width: 240 },
					{ field: 'qty_display', label: t('priced_lines.col_qty'), align: 'end', width: 104 },
					{
						field: 'unit_rate',
						label: t('priced_lines.col_rate'),
						kind: { kind: 'decimal', scale: 2 },
						align: 'end',
						width: 112
					},
					{
						field: 'amount',
						label: t('priced_lines.col_amount'),
						kind: { kind: 'decimal', scale: 2 },
						align: 'end',
						width: 120
					}
				]}
			/>
		</Bound>
	{:else}
		<Table
			{ctx}
			of={tableRows}
			controlled
			embedded
			columns={[
				{ field: 'code', label: t('commercial.col_code') },
				{ field: 'source_label', label: t('priced_lines.col_source'), cell: sourceCell },
				{ field: 'description', label: t('commercial.col_item') },
				{ field: 'qty_display', label: t('priced_lines.col_qty'), align: 'end' },
				{
					field: 'unit_rate',
					label: t('priced_lines.col_rate'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'amount',
					label: t('priced_lines.col_amount'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				}
			]}
		/>
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
