<script lang="ts">
	import { Scroll } from '@norbital-ai/ui/layout';
	let { label, details }: { label: string; details: string } = $props();
</script>

<Scroll name={label} max="compact">
	<p class="whitespace-pre-line">{details}</p>
</Scroll>
