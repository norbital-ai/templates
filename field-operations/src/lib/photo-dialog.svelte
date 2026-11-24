<script lang="ts">
	/** A filed photo at full size; closing it clears `photo`. */
	import { Dialog, Image } from '@norbital-ai/ui';
	let { photo = $bindable() }: { photo: { name: string; url: string } | null } = $props();
</script>

<Dialog.Root open={photo !== null} on_open_change={(next: boolean) => !next && (photo = null)}>
	<Dialog.Content class="max-w-5xl">
		{#if photo}
			<Dialog.Header><Dialog.Title>{photo.name}</Dialog.Title></Dialog.Header>
			<Image
				src={photo.url}
				alt={photo.name}
				class="min-h-48 w-full rounded-md"
				image_class="max-h-[75dvh] w-full object-contain"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
