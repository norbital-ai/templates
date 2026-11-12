<script lang="ts">
	/**
	 * The jobs this viewer may see: a contractor's own (the policy scopes the read), or everybody's for a controller,
	 * who also files new ones. The status filter is the table's view popover.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	/** Dispatchers read the review ledgers; a contractor's catalog has no such model. */
	const dispatcher = $derived(ctx.catalog?.['suspicion_reviews'] !== undefined);
</script>

<AppShell
	icon="lucide:hard-hat"
	title={t('app.field_ops_contractor.header_title')}
	description={t('app.field_ops_contractor.header_description')}
>
	<Table
		of="job_assignments"
		key="jobs"
		toolbar={{
			title: t('app.field_ops_contractor.dispatched_jobs'),
			description: dispatcher
				? t('app.field_ops_contractor.scope_workspace')
				: t('app.field_ops_contractor.scope_own'),
			new: dispatcher
		}}
		order_by={{ dispatched_at: 'desc' }}
		columns={[
			{ field: 'title', label: t('component.job') },
			{ field: 'site_id', label: t('component.site') },
			{ field: 'scheduled_for', label: t('component.scheduled') },
			...(dispatcher
				? [{ field: 'assignee_user_id', label: t('component.contractor') } as const]
				: []),
			{ field: 'status', label: t('component.status') }
		]}
	/>
</AppShell>
