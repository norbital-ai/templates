<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { record }: RepresentationProps = $props();
	const manualSourceKey = `manual:${crypto.randomUUID()}`;
	const defaultValues = $derived(
		record ?? {
			kind: 'MANUAL_ADJUSTMENT' as const,
			effective_on: todayKey(),
			source_key: manualSourceKey
		}
	);
</script>

<CollectionForm {client} collection="leave_entries" {defaultValues} disabled={record != null}>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field name="leave_account_id" label="Leave account" />
			<Field name="kind" label="Movement" hidden={record == null} />
			<Field name="effective_on" label="Effective date" />
			<Field name="days" label="Days" />
			<Field name="source_key" label="Reference" />
			<Column span="all"><Field name="reason" label="Reason" /></Column>
			{#if record != null}
				<Field name="expires_on" label="Expires" />
				<Field name="source_request_id" label="Leave request" />
				<Field name="leave_plan_id" label="Leave plan" />
				<Field name="statutory_profile_id" label="Statutory profile" />
			{/if}
		</Grid>
	{/snippet}
</CollectionForm>
