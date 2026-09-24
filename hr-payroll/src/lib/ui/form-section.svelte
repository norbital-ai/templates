<script lang="ts">
	/**
	 * One segment of a form: a title, one sentence saying what the segment decides, and its fields.
	 * Every section but the first is separated from the one above by a rule and a step of padding.
	 *
	 * The sentence sits behind an info icon beside the title, not as a paragraph: a description
	 * laced between sections is read once and then becomes clutter the next time a reader passes it.
	 */
	import type { Snippet } from 'svelte';
	import Icon from '@iconify/svelte';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tooltip } from '@norbital-ai/ui/tooltip';

	let {
		title,
		hint,
		first = false,
		trailing,
		actions,
		children
	}: {
		title: string;
		hint?: string;
		first?: boolean;
		/** A mark that belongs on the title row — a state badge, never a control. */
		trailing?: Snippet;
		/** Controls that act on the section, pushed to the end of the title row. */
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<Stack as="section" gap="sm" class={first ? undefined : 'border-t pt-6'}>
	<Inline gap="xs" align="center">
		<h3 class="text-base font-semibold">{title}</h3>
		{#if hint}
			<Tooltip
				side="bottom"
				align="start"
				sideOffset={6}
				contentClass="max-w-96 border bg-popover text-popover-foreground"
				arrowClasses="text-popover"
			>
				{#snippet trigger({ props })}
					<button
						{...props}
						type="button"
						aria-label={title}
						class="size-5 shrink-0 rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Inline as="span" justify="center" fill>
							<Icon icon="lucide:info" class="size-3" aria-hidden="true" />
						</Inline>
					</button>
				{/snippet}
				{#snippet content()}
					<p class="px-2.5 py-2 text-left text-xs text-muted-foreground">{hint}</p>
				{/snippet}
			</Tooltip>
		{/if}
		{#if trailing}
			{@render trailing()}
		{/if}
		{#if actions}
			<Inline as="span" gap="sm" class="ml-auto">{@render actions()}</Inline>
		{/if}
	</Inline>
	{@render children()}
</Stack>
