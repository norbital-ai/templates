<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack } from '@norbital-ai/ui/layout';

	/** A control under its caption; the caption is its accessible name. `muted` is the compact form's caption. */
	let {
		label,
		class: className = 'text-sm',
		muted = false,
		children
	}: { label: string; class?: string; muted?: boolean; children: Snippet } = $props();
</script>

<label class={className}>
	<Stack gap="xs">
		{#if muted}<span class="text-muted-foreground">{label}</span>{:else}{label}{/if}
		{@render children()}
	</Stack>
</label>
