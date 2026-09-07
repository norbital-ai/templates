<script lang="ts">
	import { collectionClient } from '../../collection-client.js';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();

	const subtitle = $derived(
		record == null
			? undefined
			: `${record.worker_number ?? '—'} · ${record.trade ?? '—'} · ${record.status ?? '—'}`
	);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/construction/record-media/workers-banner.svg"
	/>
</svelte:head>

<RecordShell title={record?.worker_name ?? 'New worker'} {subtitle}>
	<CollectionForm
		client={collectionClient}
		collection="workers"
		defaultValues={record ?? undefined}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="emergency_contact" hidden />
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
</RecordShell>
