<script lang="ts">
	/**
	 * The one CEL expression control outside a matrix — used as a `Field` renderer, so its label,
	 * description tooltip, history and errors stay the form field's, exactly as for a text input.
	 *
	 * A matrix row is one fixed-height line and uses `expression-cell.svelte`; this one owns the
	 * line under the control: the same sentence the write hook would refuse with. The Fields list a
	 * writer needs is part of the field's description tooltip (`descriptionExtra`), not a link
	 * under the input, so the control keeps one shape everywhere.
	 */
	import { Input } from '@norbital-ai/ui/input';
	import { compileExpression } from '../expressions/compile.js';
	import type { ExpressionSite, ExpressionType } from '../expressions/contexts.js';

	type Props = {
		readonly site: ExpressionSite;
		readonly type: ExpressionType;
		readonly value?: unknown;
		readonly mode?: 'display' | 'edit';
		readonly disabled?: boolean;
		readonly placeholder?: string;
		readonly class?: string;
		readonly onValueChange?: (value: string) => void;
	};

	let {
		site,
		type,
		value,
		mode = 'edit',
		disabled = false,
		placeholder,
		class: className,
		onValueChange
	}: Props = $props();
	const text = $derived(value == null ? '' : String(value));
	const fault = $derived(
		mode === 'display' ? null : compileExpression({ expression: text, site, type })
	);
</script>

<div class="flex min-w-0 flex-col gap-0.5 {className ?? ''}">
	{#if mode === 'display'}
		<span class="block min-w-0 font-mono text-xs break-words">{text === '' ? '—' : text}</span>
	{:else}
		<Input
			class="h-8 font-mono text-xs"
			value={text}
			{disabled}
			{placeholder}
			oninput={(event) => onValueChange?.(event.currentTarget.value)}
		/>
		{#if fault != null}
			<p class="text-xs text-destructive" role="alert">{fault}</p>
		{/if}
	{/if}
</div>
