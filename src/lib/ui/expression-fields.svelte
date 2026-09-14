<script lang="ts">
	/**
	 * The Fields panel: every member one expression site may read, rendered from
	 * `EXPRESSION_CONTEXTS` (RFC 0001 §7).
	 *
	 * The catalogue is the single source of truth — the compiler checks a written expression
	 * against it and this panel shows the same object, so the panel can never document a member
	 * the compiler refuses or omit one it allows. It opens beside an expression input and stays
	 * collapsed until the operator asks for it: a list of twenty-five members printed under every
	 * CEL field would be the form.
	 *
	 * When the caller passes the expression it is checking, the panel compiles it live and prints
	 * the same sentence the write hook would refuse with.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import {
		EXPRESSION_CONTEXTS,
		type ExpressionSite,
		type ExpressionType
	} from '../expressions/contexts.js';
	import { compileExpression } from '../expressions/compile.js';

	type Props = {
		readonly site: ExpressionSite;
		/** The expression under the input, for live compile feedback. Omit for the list alone. */
		readonly expression?: string;
		readonly type?: ExpressionType;
		readonly open?: boolean;
	};

	let { site, expression, type, open = false }: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const context = $derived(EXPRESSION_CONTEXTS[site]);
	const fault = $derived(
		expression == null || type == null ? null : compileExpression({ expression, site, type })
	);
</script>

<details
	class="rounded-md border border-border bg-muted/20 text-xs"
	data-expression-fields={site}
	{open}
>
	<summary class="cursor-pointer px-2 py-1 font-medium text-muted-foreground">
		{t('component.expression_fields')}
	</summary>
	<div class="flex flex-col gap-2 border-t border-border px-2 py-2">
		<p class="text-muted-foreground">{context.description}</p>
		<dl class="grid gap-1">
			{#each context.fields as field (field.path)}
				<div class="grid grid-cols-[minmax(10rem,auto)_1fr] gap-2">
					<dt class="font-mono">{field.path}</dt>
					<dd class="text-muted-foreground">{field.description}</dd>
				</div>
			{/each}
		</dl>
		{#if fault != null}
			<p class="text-destructive" role="alert">{fault}</p>
		{/if}
	</div>
</details>
