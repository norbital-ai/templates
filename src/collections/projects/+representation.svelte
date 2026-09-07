<script lang="ts">
	import { collectionClient } from '../../collection-client.js';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import ProjectRepresentation from './project-representation.svelte';

	let { record, close }: RepresentationProps = $props();

	const subtitle = $derived(
		record == null
			? undefined
			: `${record.project_number ?? '—'} · ${record.client ?? '—'} · ${record.status ?? '—'}`
	);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/construction/record-media/projects-banner.svg"
	/>
</svelte:head>

<RecordShell title={record?.project_name ?? 'New project'} {subtitle}>
	{#if record}
		<ProjectRepresentation {record} />
	{:else}
		<CollectionForm client={collectionClient} collection="projects" onAfterSubmit={close}>
			{#snippet children({ Field })}
				<Grid minimum="compact">
					<Field name="project_name" />
					<Field name="project_number" />
					<Field name="client" />
					<Field name="main_contractor" />
					<Field name="status" />
					<Field name="schedule_range" />
					<Field name="contract_value" />
					<Field name="project_type" />
					<Field name="address" />
					<Field name="project_manager" />
					<Field name="description" />
				</Grid>
			{/snippet}
		</CollectionForm>
	{/if}
</RecordShell>
