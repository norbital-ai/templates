<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';

	let { record, close }: RepresentationProps = $props();
</script>

<CollectionForm
	{client}
	collection="leave_plans"
	defaultValues={record ?? undefined}
	submitLabel={record ? 'Save leave plan' : 'Create draft leave plan'}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field name="company_id" label="Legal entity" />
			<Field name="code" label="Plan code" />
			<Field name="name" label="Plan name" />
			<Field name="lifecycle" label="Status" />
			<Field name="transition" label="Mid-year treatment" />
			<Field name="effective_range" label="Effective period" />
			<Field name="supersedes_id" label="Previous plan version" />
			<Column span="all"><Field name="change_note" label="Reason for this version" /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
