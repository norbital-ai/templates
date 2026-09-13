<script lang="ts">
	import { client } from '$bolt/client';
	import type { RepresentationProps } from './$types.js';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'companies form');
</script>

<CollectionForm
	client={workspaceClient}
	collection="companies"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="name" />
			<Field name="status" />
			<Field name="industry" />
			<Field name="region" />
			<Field name="website" />
			<Field name="nda_required" />
			<Field name="nda_signed_on" />
			<Field name="nda_document" />
			<Field name="notes" />
		</Grid>
	{/snippet}
</CollectionForm>
