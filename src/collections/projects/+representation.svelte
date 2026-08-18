<script lang="ts">
	import { collectionClient } from '../../collection-client.js';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import ProjectRepresentation from './project-representation.svelte';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/construction/record-media/projects-banner.svg"
	/>
</svelte:head>

{#if record}
	<ProjectRepresentation {record} />
{:else}
	<CollectionForm client={collectionClient} collection="projects" onAfterSubmit={close} />
{/if}
