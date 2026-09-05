<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type { LeavePreview } from '../../lib/leave/preview.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const preview = $derived(
		record
			? (client.invoke.preview_leave({
					employment_id: record.employment_id,
					leave_type_id: record.leave_type_id,
					allocation_id: record.id,
					calendar_month: todayKey().slice(0, 7)
				}) as RemoteQuery<LeavePreview>)
			: null
	);
	const balance = $derived(preview?.current?.allocation_balance);
</script>

<Stack gap="md">
	<p class="text-sm text-muted-foreground">{t('app.leave.allocations_description')}</p>
	{#if balance}
		<Grid gap="md" minimum="compact">
			<div>
				<p class="text-sm text-muted-foreground">{t('app.hr_employee.leave_taken')}</p>
				<p class="text-heading">{balance.approved}</p>
			</div>
			<div>
				<p class="text-sm text-muted-foreground">{t('app.hr_employee.leave_pending')}</p>
				<p class="text-heading">{balance.pending}</p>
			</div>
			<div>
				<p class="text-sm text-muted-foreground">{t('app.hr_employee.leave_balance')}</p>
				<p class="text-heading">{balance.remaining}</p>
			</div>
		</Grid>
	{:else if preview?.error}
		<p role="alert" class="text-sm text-destructive">{preview.error.message}</p>
	{/if}
	<CollectionForm
		{client}
		collection="leave_allocations"
		defaultValues={record ?? undefined}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field name="employment_id" label={t('component.person')} />
				<Field name="leave_type_id" label={t('component.leave_type')} />
				<Field name="event_reference" label={t('component.allocation_reference')} />
				<Field name="qualifying_date" label={t('component.qualifying_date')} />
				<Field name="starts_on" label={t('component.allocation_start')} />
				<Field name="expires_on" label={t('renderer.leave_event.expires_on')} />
				<Field name="allocated_days" label={t('component.allocated_workdays')} />
				<Field name="eligibility_evidence" label={t('component.allocation_evidence')} />
			</Grid>
		{/snippet}
	</CollectionForm>
</Stack>
