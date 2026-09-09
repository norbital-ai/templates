<script lang="ts">
	/**
	 * One segment of a form: a title, one sentence saying what the segment decides, and its fields.
	 * Every section but the first is separated from the one above by a rule and a step of padding.
	 */
	import type { Snippet } from 'svelte';
	import { Stack } from '@norbital-ai/ui/layout';

	let {
		title,
		hint,
		first = false,
		children
	}: { title: string; hint?: string; first?: boolean; children: Snippet } = $props();
</script>

<Stack as="section" gap="sm" class={first ? undefined : 'border-t pt-6'}>
	<Stack gap="xs">
		<h3 class="text-base font-semibold">{title}</h3>
		{#if hint}
			<p class="text-meta">{hint}</p>
		{/if}
	</Stack>
	{@render children()}
</Stack>
