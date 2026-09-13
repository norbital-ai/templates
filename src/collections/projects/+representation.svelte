<script lang="ts">
	import { client } from '$bolt/client';
	import type { RepresentationProps } from './$types.js';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'projects form');
</script>

<CollectionForm
	client={workspaceClient}
	collection="projects"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="name" />
			<Field
				name="company_id"
				relationOptions={{
					label: (row) => String(row.name ?? ''),
					orderBy: { name: 'asc' },
					limit: 500
				}}
			/>
			<Field
				name="lead_contact_id"
				relationOptions={{
					label: (row) => String(row.full_name ?? ''),
					orderBy: { full_name: 'asc' },
					limit: 500
				}}
			/>
			<Field name="status" />
			<Field name="start_on" />
			<Field name="target_on" />
			<Field name="budget" />
			<Field name="summary" />
		</Grid>
	{/snippet}
</CollectionForm>
