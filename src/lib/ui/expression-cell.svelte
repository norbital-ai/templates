<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One CEL text cell for a matrix: the expression input, the Fields popover beside it and the
	 * live compile fault. The site and result type ride the column's field options, so a matrix
	 * column declares `options: { site: 'work_day', type: 'number' }` once and every row reads it.
	 *
	 * A readonly matrix renders the expression as text: a disabled input is a muted form control,
	 * and a display surface is neither.
	 */
	import InfoTip from './InfoTip.svelte';
	import { t } from './t.js';
	import type { MatrixCellRendererProps, MatrixRow } from './grid.svelte';
	import { Input } from '@norbital-ai/ui';
	import { Inline } from '@norbital-ai/ui/layout';
	import ExpressionFields from './expression-fields.svelte';
	import type { ExpressionSite, ExpressionType } from '../expressions/contexts.js';

	let { field, value, mode, disabled, placeholder, onValueChange }: MatrixCellRendererProps<TRow> =
		$props();
	const site = $derived((field.options?.site ?? 'work_day') as ExpressionSite);
	const type = $derived((field.options?.type ?? 'money') as ExpressionType);
	const text = $derived(value == null ? '' : String(value));
	/** One fixed-height line, so the contract rides the input's title. */
	const contract = $derived(`${t(`expression.returns.${type}`)} · ${t(`expression.site.${site}`)}`);
</script>

{#if mode === 'display'}
	<Inline gap="xs" align="center"
		><span class="block min-w-0 font-mono text-xs break-words">{text === '' ? '—' : text}</span
		><InfoTip label={t('component.rule_calculation')}>{contract}</InfoTip></Inline
	>
{:else}
	<Inline gap="xs">
		<Input
			class="h-8 min-w-0 flex-1 font-mono text-xs"
			value={text}
			{disabled}
			{placeholder}
			title={contract}
			oninput={(event) => onValueChange(event.currentTarget.value)}
		/>
		<InfoTip label={t('component.rule_calculation')}>{contract}</InfoTip>
		<ExpressionFields {site} expression={text} {type} inline />
	</Inline>
{/if}
