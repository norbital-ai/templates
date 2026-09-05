<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { record, close }: RepresentationProps = $props();
	const today = todayKey();
	const formValues = $derived(
		record ?? {
			account_kind: 'EVENT' as const,
			qualifying_date: today,
			statutory_cohort_date: today,
			starts_on: today,
			ends_on: today
		}
	);
</script>

<CollectionForm
	{client}
	collection="leave_accounts"
	defaultValues={formValues}
	disabled={record != null}
	submitLabel="Create event entitlement"
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			{#if record == null}
				<Field name="account_kind" hidden />
				<Field name="employment_id" label="Employment" />
				<Field
					name="leave_type_id"
					label="Event-based leave type"
					relationOptions={{
						where: { account_basis: { eq: 'EVENT' } },
						label: (leaveType) => `${leaveType.code} · ${leaveType.name}`,
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="event_reference" label="Household or event reference" />
				<Field name="qualifying_date" label="Actual qualifying event date" />
				<Field name="statutory_cohort_date" label="Statutory cohort date" />
				<Field name="starts_on" label="Available from" />
				<Field name="ends_on" label="Use by" />
				<Field name="allocation_units" label="Verified allocation (profile units)" />
				<Field name="weekly_index" label="Verified working days per week" />
				<Field name="eligibility_evidence" label="Eligibility and allocation evidence" />
			{:else}
				<Field name="employment_id" label="Employment" />
				<Field name="leave_type_id" label="Leave type" />
				<Field name="account_kind" label="Account basis" />
				{#if record.account_kind === 'EVENT'}
					<Field name="event_reference" label="Event reference" />
					<Field name="qualifying_date" label="Qualifying event" />
					<Field name="statutory_cohort_date" label="Statutory cohort" />
					<Field name="allocation_units" label="Allocated profile units" />
					<Field name="weekly_index" label="Working days per week" />
					<Field name="eligibility_evidence" label="Verified evidence" />
				{:else}
					<Field name="leave_year" label="Leave year" />
				{/if}
				<Field name="leave_code" label="Code" />
				<Field name="leave_name" label="Name" />
				<Field name="starts_on" label="Starts" />
				<Field name="ends_on" label="Ends" />
				<Field name="entitlement_days" label="Calculated entitlement" />
				<Field name="status" label="Status" />
			{/if}
		</Grid>
	{/snippet}
</CollectionForm>
