<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Section } from '@norbital-ai/ui';

	let props: ComponentProps<typeof Section> = $props();
</script>

<Section {...props} />
