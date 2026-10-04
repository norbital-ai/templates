<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '@norbital-ai/ui';
	import { Imposter } from '@norbital-ai/ui/layout';
	let {
		id,
		value,
		onChange,
		children
	}: { id: string; value: string; onChange: (value: string) => void; children: Snippet } = $props();
</script>

<div class="relative">
	<select
		{id}
		{value}
		onchange={(e) => onChange(e.currentTarget.value)}
		class="h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-10 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
	>
		{@render children()}
	</select>
	<Imposter placement="center-end" offset="md" class="pointer-events-none" aria-hidden="true">
		<Icon name="lucide:chevron-down" class="size-4 text-muted-foreground" />
	</Imposter>
</div>
