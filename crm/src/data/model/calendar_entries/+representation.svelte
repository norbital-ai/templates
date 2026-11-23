<script lang="ts">
	import type { RecordView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		RecordShell,
		Timeline,
		enum_text,
		format,
		open_record,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'calendar_entries'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const words: { t(key: string): string } = ctx;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const linked = $derived(
		record === null
			? null
			: ctx.query({
					activities: {
						where: {
							source_calendar: { eq: record.id },
							external_id: { eq: record.external_id }
						},
						fields: ['subject', 'occurred_at', 'classification', 'calendar_status'],
						order_by: { occurred_at: 'desc' },
						company: { fields: ['name'] },
						project_id: { fields: ['name'] }
					}
				})
	);
	const timelineEntries = $derived<TimelineEntry[]>(
		(linked?.current?.activities.rows ?? []).map((row) => ({
			key: row.id,
			icon: 'lucide:calendar-days',
			tone:
				row.calendar_status === 'cancelled'
					? 'danger'
					: row.calendar_status === 'tentative'
						? 'warning'
						: 'brand',
			title: row.subject,
			line: [
				format({ kind: 'instant' }, row.occurred_at, { locale: ctx.locale }),
				...(row.company?.name ? [row.company.name] : []),
				...(row.project_id?.name ? [row.project_id.name] : []),
				...(row.classification
					? [
							enum_text(row.classification, {
								t: (key) => words.t(key),
								model: 'activities',
								field: 'classification'
							})
						]
					: [])
			],
			...(row.calendar_status
				? {
						mark: {
							text: enum_text(row.calendar_status, {
								t: (key) => words.t(key),
								model: 'activities',
								field: 'calendar_status'
							}),
							variant:
								row.calendar_status === 'cancelled'
									? ('destructive' as const)
									: row.calendar_status === 'tentative'
										? ('warning' as const)
										: ('outline' as const)
						}
					}
				: {}),
			onpick: () => open_record('activities', row.id)
		}))
	);
</script>

{#snippet activity()}
	{#if record}
		<Scroll name={t('calendar.crm_activity')} size="fill" inset>
			<Timeline entries={timelineEntries} label={t('calendar.crm_activity')}>
				{#snippet empty()}
					<EmptyState title={t('timeline.empty')} hint={t('timeline.empty_help')} />
				{/snippet}
			</Timeline>
		</Scroll>
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
