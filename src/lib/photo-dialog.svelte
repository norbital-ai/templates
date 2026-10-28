<script lang="ts">
	/** A filed photo at full size; closing it clears `photo`. */
	import { Dialog } from '@norbital-ai/ui';
	let { photo = $bindable() }: { photo: { name: string; url: string } | null } = $props();
</script>

<Dialog.Root open={photo !== null} onOpenChange={(next) => !next && (photo = null)}>
	<Dialog.Content class="max-w-5xl">
		{#if photo}
			<Dialog.Header><Dialog.Title>{photo.name}</Dialog.Title></Dialog.Header>
			<img
				src={photo.url}
				alt={photo.name}
				class="max-h-[75dvh] w-full rounded-md object-contain"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
