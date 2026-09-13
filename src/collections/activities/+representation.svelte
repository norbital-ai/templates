<script lang="ts">
	import { client } from '$bolt/client';
	import type { RepresentationProps } from './$types.js';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'activities form');
</script>

<CollectionForm
	client={workspaceClient}
	collection="activities"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="subject" />
			<Field name="kind" />
			<Field name="happened_on" />
			<Field
				name="project_id"
				relationOptions={{
					label: (row) => String(row.name ?? ''),
					orderBy: { name: 'asc' },
					limit: 500
				}}
			/>
			<Field
				name="contact_id"
				relationOptions={{
					label: (row) => String(row.full_name ?? ''),
					orderBy: { full_name: 'asc' },
					limit: 500
				}}
			/>
			<Field name="detail" />
			<Field name="recording" />
		</Grid>
	{/snippet}
</CollectionForm>
