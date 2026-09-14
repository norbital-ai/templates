<script lang="ts">
	/**
	 * The Fields affordance: every member one expression site may read, rendered from
	 * `EXPRESSION_CONTEXTS` (RFC 0001 §7).
	 *
	 * The catalogue is the single source of truth — the compiler checks a written expression
	 * against it and this list shows the same object, so it can never document a member the
	 * compiler refuses or omit one it allows.
	 *
	 * `popover` draws its own trigger; a caller that already owns a tooltip — a form field's
	 * description — takes `members` and renders the list inside it. When the caller passes the
	 * expression it is checking, a compile fault stays on the page as the same sentence the write
	 * hook would refuse with.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import * as Popover from '@norbital-ai/ui/popover';
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
		/**
		 * A matrix row is one fixed-height line: `inline` keeps the trigger beside the input and
		 * carries the fault as the trigger's title instead of a paragraph under it.
		 */
		readonly inline?: boolean;
		/** `popover` owns a trigger; `members` is the list alone for a caller-owned tooltip. */
		readonly mode?: 'popover' | 'members';
	};

	let { site, expression, type, inline = false, mode = 'popover' }: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const context = $derived(EXPRESSION_CONTEXTS[site]);
	const fault = $derived(
		expression == null || type == null ? null : compileExpression({ expression, site, type })
	);
</script>

{#snippet members()}
	<p class="text-muted-foreground">{context.description}</p>
	<dl class="grid gap-1">
		{#each context.fields as field (field.path)}
			<div class="grid grid-cols-[minmax(9rem,auto)_1fr] gap-2">
				<dt class="font-mono">{field.path}</dt>
				<dd class="text-muted-foreground">{field.description}</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#if mode === 'members'}
	<div class="flex flex-col gap-2" data-expression-fields={site}>
		{@render members()}
	</div>
{:else}
	<div
		class={inline ? 'flex min-w-0 shrink-0 items-center' : 'flex flex-col gap-1'}
		data-expression-fields={site}
	>
		<Popover.Root>
			<Popover.Trigger
				type="button"
				class={`w-fit text-xs font-medium underline decoration-dotted underline-offset-2 ${fault != null ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
				title={inline && fault != null ? fault : undefined}
			>
				{t('component.expression_fields')}
			</Popover.Trigger>
			<Popover.Content
				align="start"
				sideOffset={6}
				class="max-h-[min(28rem,calc(100dvh-6rem))] w-[38rem] max-w-[90vw] overflow-auto p-3 text-xs"
			>
				{#if inline && fault != null}
					<p class="mb-2 text-destructive" role="alert">{fault}</p>
				{/if}
				{@render members()}
			</Popover.Content>
		</Popover.Root>
		{#if !inline && fault != null}
			<p class="text-xs text-destructive" role="alert">{fault}</p>
		{/if}
	</div>
{/if}
