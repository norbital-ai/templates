<script lang="ts">
	/**
	 * The Fields affordance: every member one expression site may read, rendered from
	 * `EXPRESSION_CONTEXTS`.
	 *
	 * The catalogue is the single source of truth — the compiler checks a written expression
	 * against it and this list shows the same object, so it can never document a member the
	 * compiler refuses or omit one it allows.
	 *
	 * `popover` draws its own trigger; a caller that already owns a tooltip — a form field's
	 * description — takes `members` and renders the list inside it. When the caller passes the
	 * expression it is checking, a compile fault stays on the page as the same sentence the write
	 * transform would refuse with.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
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
	<Stack as="dl" gap="xs">
		{#each context.fields as field (field.path)}
			<Grid tracks="minmax(9rem,auto) 1fr" gap="sm">
				<dt class="font-mono">{field.path}</dt>
				<dd class="text-muted-foreground">{field.description}</dd>
			</Grid>
		{/each}
	</Stack>
	<p class="text-muted-foreground">{t('component.expression_functions')}</p>
	<Stack as="dl" gap="xs">
		{#each context.functions as fn (fn.path)}
			<Grid tracks="minmax(9rem,auto) 1fr" gap="sm">
				<dt class="font-mono">{fn.path}</dt>
				<dd class="text-muted-foreground">{fn.description}</dd>
			</Grid>
		{/each}
	</Stack>
{/snippet}

{#snippet popover()}
	<Popover.Root>
		<Popover.Trigger
			type="button"
			class={`w-fit text-xs font-medium underline decoration-dotted underline-offset-2 ${fault != null ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
			title={inline && fault != null ? fault : undefined}
		>
			{t('component.expression_fields')}
		</Popover.Trigger>
		<Popover.Content align="start" sideOffset={6} class="p-0 text-xs">
			<Scroll
				name={t('component.expression_fields')}
				max="standard"
				class="w-[38rem] max-w-[90vw] p-3"
			>
				{#if inline && fault != null}
					<p class="pb-2 text-destructive" role="alert">{fault}</p>
				{/if}
				{@render members()}
			</Scroll>
		</Popover.Content>
	</Popover.Root>
{/snippet}

{#if mode === 'members'}
	<Stack gap="sm" data-expression-fields={site}>
		{@render members()}
	</Stack>
{:else if inline}
	<Inline gap="none" shrink={false} data-expression-fields={site}>
		{@render popover()}
	</Inline>
{:else}
	<Stack gap="xs" data-expression-fields={site}>
		{@render popover()}
		{#if fault != null}
			<p class="text-xs text-destructive" role="alert">{fault}</p>
		{/if}
	</Stack>
{/if}
