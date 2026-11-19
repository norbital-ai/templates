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
		children
	}: {
		title: string;
		icon: string;
		href?: string;
		selected?: boolean;
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<Bound
	as={href ? 'a' : onclick ? 'button' : 'div'}
	{href}
	type={onclick ? 'button' : undefined}
	aria-pressed={onclick ? Boolean(selected) : undefined}
	{onclick}
	pad="md"
	class={href || onclick
		? selected
			? 'rounded-lg border border-primary bg-card text-start'
			: 'rounded-lg border bg-card text-start transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'
		: 'rounded-lg border bg-card text-start'}
>
	<Stack as="span" gap="xs">
		<Inline as="span" justify="between" gap="sm">
			<span class="text-overline">{title}</span>
			<Icon name={href ? 'lucide:arrow-up-right' : icon} class="size-4 text-muted-foreground" />
		</Inline>
		{@render children()}
	</Stack>
</Bound>
