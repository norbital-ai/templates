<script lang="ts">
	import { collectionClient } from '../../collection-client.js';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
</script>

<CollectionForm
	client={collectionClient}
	collection="certification_types"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="requirements" hidden />
		<Grid minimum="compact">
			<Field name="certification_name" />
			<Field name="certification_code" />
			<Field name="category" />
			<Field name="issuing_body" />
			<Field name="validity_period_months" />
			<Field name="requires_refresher" />
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
