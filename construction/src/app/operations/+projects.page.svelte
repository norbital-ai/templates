<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, Tabs } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	/** Messages no project could be found for wait here until someone files them to one. */
	const unfiled = ctx.query({
		project_messages: {
			where: { classification: { eq: 'review' }, project_id: { is_null: true } },
			aggregate: { count: true }
		}
	});
	const hasUnfiled = $derived((unfiled.current?.project_messages.count ?? 0) > 0);
</script>

{#snippet projects()}
	<Table
		{ctx}
		of="projects"
		page_size={50}
		toolbar={{ title: false }}
		columns={[
			'project_name',
			'project_number',
			'project_role',
			'client_id',
			'status',
			'schedule_range',
			'open_task_count',
			'active_contract_count'
		]}
	/>
{/snippet}

{#snippet unfiledMessages()}
	<Table
		{ctx}
		of="project_messages"
		key="unfiled-messages"
		where={{ classification: { eq: 'review' }, project_id: { is_null: true } }}
		order_by={{ occurred_at: 'desc' }}
		toolbar={{
			title: false,
			description: ctx.t('updates.unfiled_description'),
			new: false
		}}
		columns={['occurred_at', 'sender_name', 'subject', 'reason', 'project_id']}
	/>
{/snippet}

<AppShell
	icon="lucide:building-2"
	title={ctx.t('app.operations.page_projects')}
	description={ctx.t('app.operations.projects_description')}
	banner="app-media/construction_project_workspace-banner.webp"
	variant={hasUnfiled ? 'full' : 'page'}
>
	{#if hasUnfiled}
		<Tabs
			level={2}
			tabs={[
				{ name: 'projects', title: ctx.t('app.operations.page_projects'), body: projects },
				{ name: 'unfiled', title: ctx.t('updates.unfiled_title'), body: unfiledMessages }
			]}
		/>
	{:else}
		{@render projects()}
	{/if}
</AppShell>
