<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button, Icon, Tooltip } from '@norbital-ai/ui';

	const descriptionId = $props.id();

	/** An info button whose tooltip explains the thing beside it; a rich tooltip passes the popover classes. */
	let {
		label,
		contentClass = 'max-w-80',
		arrowClasses,
		children
	}: { label: string; contentClass?: string; arrowClasses?: string; children: Snippet } = $props();
</script>

<Tooltip
	side="bottom"
	align="start"
	{contentClass}
	{...arrowClasses == null ? {} : { arrowClasses }}
>
	{#snippet trigger({ props })}
		<Button
			{...props}
			variant="ghost"
			size="icon"
			aria-label={label}
			aria-describedby={descriptionId}
		>
			<Icon name="lucide:info" class="size-4" />
		</Button>
	{/snippet}
	{#snippet content()}<div id={descriptionId} role="tooltip">{@render children()}</div>{/snippet}
</Tooltip>
