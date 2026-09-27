<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';

	/** A flow in a dialog: the title names the scroll region, and the flow mounts only while open. */
	let {
		open = $bindable(false),
		title,
		description,
		children
	}: { open?: boolean; title: string; description: string; children: Snippet } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl p-0">
		<Scroll name={title} layout="stack" gap="md" max="tall" class="max-h-[90dvh] p-6">
			<Dialog.Header>
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>{description}</Dialog.Description>
			</Dialog.Header>
			{#if open}{@render children()}{/if}
		</Scroll>
	</Dialog.Content>
</Dialog.Root>
