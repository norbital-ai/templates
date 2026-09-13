<script lang="ts">
	import { client } from '$bolt/client';
	import type { RepresentationProps } from './$types.js';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'contacts form');
</script>

<CollectionForm
	client={workspaceClient}
	collection="contacts"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="full_name" />
			<Field name="job_title" />
			<Field name="email" />
			<Field name="phone" />
			<Field
				name="company_id"
				relationOptions={{
					label: (row) => String(row.name ?? ''),
					orderBy: { name: 'asc' },
					limit: 500
				}}
			/>
			<Field name="is_primary" />
			<Field name="notes" />
		</Grid>
	{/snippet}
</CollectionForm>
