<script lang="ts">
	import type { RecordView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, RecordShell, Table } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'calendar_entries'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

{#snippet activity()}
	{#if record}
		<Table
			{ctx}
			of="activities"
			key="calendar-client-activity"
			toolbar={{ new: false }}
			where={{
				source_calendar: { eq: record.id },
				external_id: { eq: record.external_id }
			}}
			columns={['subject', 'company', 'project_id', 'classification', 'calendar_status']}
		/>
	{/if}
{/snippet}
{#if record}
	<RecordShell
		{ctx}
		of="calendar_entries"
		id={record.id}
		icon="lucide:calendar-days"
		fields={record.start_on === null
			? [
					'subject',
					'event_status',
					'start_at',
					'end_at',
					'location',
					'description',
					'web_url',
					'start_zone',
					'end_zone'
				]
			: ['subject', 'event_status', 'start_on', 'end_on', 'location', 'description', 'web_url']}
		sections={[
			{
				name: 'event',
				fields: [
					'subject',
					'event_status',
					'start_at',
					'end_at',
					'start_on',
					'end_on',
					'location',
					'description',
					'web_url'
				]
			},
			{
				name: 'time_zones',
				icon: 'lucide:globe',
				title: t('calendar.time_zones'),
				fields: ['start_zone', 'end_zone'],
				default_open: false
			}
		]}
		tabs={[
			{
				name: 'activity',
				title: t('calendar.crm_activity'),
				icon: 'lucide:activity',
				body: activity
			}
		]}
	/>
{:else}
	<EmptyState icon="inbox" title={t('calendar.source_only')} hint={t('calendar.empty_help')} />
{/if}
