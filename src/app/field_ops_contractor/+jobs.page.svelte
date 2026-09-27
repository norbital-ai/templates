<script lang="ts">
	/**
	 * The jobs this viewer may see: a contractor's own (the policy scopes the read), or everybody's for a controller,
	 * who also files new ones. The status filter is the table's view popover.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, useKinds } from '@norbital-ai/ui';

	const t = bolt.t;
	const kinds = useKinds();
	/** Dispatchers read the review ledgers; a contractor's catalog has no such collection. */
	const dispatcher = $derived(kinds.catalog?.['suspicion_reviews'] !== undefined);
</script>

<AppShell
	icon="lucide:hard-hat"
	title={t('app.field_ops_contractor.header_title')}
	description={t('app.field_ops_contractor.header_description')}
>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">
			{dispatcher
				? t('app.field_ops_contractor.scope_workspace')
				: t('app.field_ops_contractor.scope_own')}
		</p>
		<Table
			of="job_assignments"
			key="jobs"
			toolbar={{ title: t('app.field_ops_contractor.dispatched_jobs'), new: dispatcher }}
			orderBy={{ dispatched_at: 'desc' }}
			columns={[
				{ field: 'title', label: t('component.job') },
				{ field: 'site_id', label: t('component.site') },
				{ field: 'scheduled_for', label: t('component.scheduled') },
				...(dispatcher
					? [{ field: 'assignee_user_id', label: t('component.contractor') } as const]
					: []),
				{ field: 'dispatched_at', label: t('component.dispatched') },
				{ field: 'status', label: t('component.status') },
				{ field: 'location_address', label: t('component.reported_location') },
				'summary'
			]}
		/>
	</Stack>
</AppShell>
