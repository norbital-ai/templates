<script lang="ts">
	import { client } from '$bolt/client';
	import type { RepresentationProps } from './$types.js';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'project_documents form');
</script>

<CollectionForm
	client={workspaceClient}
	collection="project_documents"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="title" />
			<Field name="kind" />
			<Field name="status" />
			<Field name="markdown_body" />
			<Field name="attachment" />
			<Field
				name="project_id"
				relationOptions={{
					label: (row) => String(row.name ?? ''),
					orderBy: { name: 'asc' },
					limit: 500
				}}
			/>
			<Field name="signed_by" />
			<Field name="signed_on" />
			<Field name="submitted_on" />
		</Grid>
	{/snippet}
</CollectionForm>
