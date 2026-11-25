<script lang="ts">
	// One dashboard figure in its card: a link to the report it counts, a button that opens its table below, or a
	// status when it opens nothing.
	import type { Snippet } from 'svelte';
	import { Icon } from '@norbital-ai/ui';
	import { Bound, Inline, Stack } from '@norbital-ai/ui/layout';
	let {
		title,
		icon,
		href,
		selected,
		onclick,
		children,
		...restProps
	}: {
		title: string;
		icon: string;
		href?: string;
		selected?: boolean;
		onclick?: () => void;
		children: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<Bound
	as={href ? 'a' : onclick ? 'button' : 'div'}
	{href}
	type={onclick ? 'button' : undefined}
	aria-pressed={onclick ? Boolean(selected) : undefined}
	{onclick}
	{...restProps}
	pad="md"
	class={href || onclick
		? selected
			? 'rounded-control border border-primary bg-surface-card text-start'
			: 'rounded-control border border-border bg-surface-card text-start transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring'
		: 'rounded-control border border-border bg-surface-card text-start'}
>
	<Stack as="span" gap="xs">
		<Inline as="span" justify="between" gap="sm">
			<span class="text-overline">{title}</span>
			<Icon name={href ? 'lucide:arrow-up-right' : icon} class="size-4 text-muted-foreground" />
		</Inline>
		{@render children()}
	</Stack>
</Bound>
