<script lang="ts">
	import { collectionClient } from '../../collection-client.js';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/construction/record-media/workers-banner.svg"
	/>
</svelte:head>

<CollectionForm
	client={collectionClient}
	collection="workers"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="worker_name" />
			<Field name="worker_number" />
			<Field name="trade" />
			<Field name="status" />
			<Field name="phone" />
			<Field name="email" />
			<Field name="date_of_birth" />
			<Field name="nationality" />
			<Field name="work_permit_expiry" />
			<Field name="medical_check_date" />
			<Field name="safety_induction_date" />
		</Grid>
	{/snippet}
</CollectionForm>
