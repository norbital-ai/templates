<script lang="ts">
	import type { Read } from '@norbital-ai/bolt/page';
	import { untrack } from 'svelte';
	import { live } from '../../src/lib/live.svelte.js';
	let { query, initial }: { query: Read<string | null>; initial: string } = $props();
	let enabled = $state(true);
	const view = live(
		() => (enabled ? query : null),
		undefined,
		untrack(() => initial)
	);
</script>

<output data-current>{view.current ?? 'loading'}</output>
<output data-error>{view.error ?? ''}</output>
<button onclick={() => (enabled = false)}>Clear query</button>
