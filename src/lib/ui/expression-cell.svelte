<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One CEL text cell for a matrix: the expression input, the Fields popover beside it and the
	 * live compile fault. The site and result type ride the column's field options, so a matrix
	 * column declares `options: { site: 'work_day', type: 'number' }` once and every row reads it.
	 *
	 * A readonly matrix renders the expression as text: a disabled input is a muted form control,
	 * and a display surface is neither.
	 */
	import type { MatrixCellRendererProps, MatrixRow } from '@norbital-ai/ui/data-renderer/matrix';
	import { Input } from '@norbital-ai/ui/input';
	import ExpressionFields from './expression-fields.svelte';
	import type { ExpressionSite, ExpressionType } from '../expressions/contexts.js';

	let { field, value, mode, disabled, placeholder, onValueChange }: MatrixCellRendererProps<TRow> =
		$props();
	const site = $derived((field.options?.site ?? 'work_day') as ExpressionSite);
	const type = $derived((field.options?.type ?? 'number') as ExpressionType);
	const text = $derived(value == null ? '' : String(value));
</script>

{#if mode === 'display'}
	<span class="block min-w-0 truncate font-mono text-xs" title={text}
		>{text === '' ? '—' : text}</span
	>
{:else}
	<div class="flex min-w-0 items-center gap-1">
		<Input
			class="h-8 min-w-0 flex-1 font-mono text-xs"
			value={text}
			{disabled}
			{placeholder}
			oninput={(event) => onValueChange(event.currentTarget.value)}
		/>
		<ExpressionFields {site} expression={text} {type} inline />
	</div>
{/if}
