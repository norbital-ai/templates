<script lang="ts">
	/**
	 * The one CEL expression control outside a matrix — used as a `Field` renderer, so its label,
	 * description tooltip, history and errors stay the form field's, exactly as for a text input.
	 *
	 * A matrix row is one fixed-height line and uses `expression-cell.svelte`; this one is a code
	 * editor (a scheme's base or a long predicate wraps over several lines) and owns the line under
	 * the control: the same sentence the transform would refuse with. The Fields list a
	 * writer needs is part of the field's description tooltip (`descriptionExtra`), not a link
	 * under the input, so the control keeps one shape everywhere.
	 */
	import InfoTip from './InfoTip.svelte';
	import { Inline } from '@norbital-ai/ui/layout';
	import { t } from './t.js';
	import { CodeEditor } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { compileExpression } from '../expressions/compile.js';
	import type { ExpressionSite, ExpressionType } from '../expressions/contexts.js';

	type Props = {
		readonly site: ExpressionSite;
		readonly type: ExpressionType;
		readonly value?: unknown;
		readonly mode?: 'display' | 'edit';
		readonly disabled?: boolean;
		readonly placeholder?: string;
		/** What an empty expression means, printed with the contract: "empty is everyone". */
		readonly empty?: string;
		readonly class?: string;
		readonly onValueChange?: (value: string) => void;
		/** The form's row: on the assessment site, the scheme's own `parts` root the part words. */
		readonly row?: Record<string, unknown>;
	};

	let {
		site,
		type,
		value,
		mode = 'edit',
		disabled = false,
		placeholder,
		empty,
		class: className,
		onValueChange,
		row
	}: Props = $props();
	const text = $derived(value == null ? '' : String(value));
	/** The contract under the input: what it returns, over which site, and what empty means. */
	const contract = $derived(
		[t(`expression.returns.${type}`), t(`expression.site.${site}`), empty]
			.filter((part) => part != null && part !== '')
			.join(' · ')
	);
	const parts = $derived(
		site === 'assessment' && Array.isArray(row?.parts) ? row.parts.map(String) : []
	);
	const fault = $derived(
		mode === 'display' ? null : compileExpression({ expression: text, site, type, parts })
	);
</script>

<Stack gap="xs" class={className}>
	{#if mode === 'display'}
		<Inline gap="xs" align="center"
			><span class="block min-w-0 font-mono text-xs break-words">{text === '' ? '—' : text}</span
			><InfoTip label={t('component.rule_calculation')}>{contract}</InfoTip></Inline
		>
	{:else}
		<CodeEditor
			language="javascript"
			value={text}
			readonly={disabled}
			invalid={fault != null}
			aria-label={placeholder ?? contract}
			onChange={(next) => onValueChange?.(next)}
		/>
		<InfoTip label={t('component.rule_calculation')}>{contract}</InfoTip>
		{#if fault != null}
			<p class="text-xs text-destructive" role="alert">{fault}</p>
		{/if}
	{/if}
</Stack>
