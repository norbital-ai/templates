<script lang="ts">
	/** An activity: what happened, when and with whom stay open; an attached recording folds away. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import ActivityCreate from '../../../../../lib/ActivityCreate.svelte';
	import MeetingActivity from '../../../../../lib/MeetingActivity.svelte';
	import { EmptyState, ReadonlyMarkdown, RecordShell } from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';
	import { transcriptMarkdown } from '../../../../../lib/ai.js';

	let { view, ctx }: { view: RecordView<'activities'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const fields = $derived([
		'subject',
		'kind',
		'occurred_at',
		'company',
		'project_id',
		'contact_id',
		'detail',
		'recording',
		...(record?.kind === 'message'
			? (['transport', 'source_user', 'handle', 'classification', 'reason'] as const)
			: ([] as const))
	] as const);
	const sections = $derived<RecordSection[]>([
		{
			name: 'activity',
			icon: 'lucide:activity',
			title: t('models.activities.singular'),
			fields: [
				'subject',
				'kind',
				'occurred_at',
				'company',
				'project_id',
				'contact_id',
				'detail',
				'recording'
			]
		},
		...(record?.kind === 'message'
			? [
					{
						name: 'source',
						icon: 'lucide:link',
						title: t('crm.accounts.mine'),
						fields: ['transport', 'source_user', 'handle', 'classification', 'reason'],
						default_open: false
					}
				]
			: [])
	]);
</script>

{#snippet transcript()}
	<Scroll name={t('meetings.transcript')} size="fill" inset>
		{#if record?.transcription === 'done'}
			<ReadonlyMarkdown value={transcriptMarkdown(record.segments ?? [], {})} />
		{:else if record?.transcription === 'pending'}
			<EmptyState variant="inset" title={t('meetings.transcribing')} />
		{:else if record?.transcription === 'failed' || record?.transcription === 'unavailable'}
			<EmptyState
				variant="inset"
				title={t(record.transcription === 'failed' ? 'meetings.failed' : 'meetings.unavailable')}
				hint={record.transcription_error ?? ''}
			/>
		{:else}<EmptyState variant="inset" title={t('meetings.no_recording')} />{/if}
	</Scroll>
{/snippet}
{#if view.mode !== 'create' && (view.record.kind === 'meeting' || view.record.kind === 'recording')}
	<MeetingActivity {ctx} {view} />
{:else if view.mode !== 'create'}
	<RecordShell
		{ctx}
		of="activities"
		id={view.record.id}
		{sections}
		{fields}
		tabs={view.record.recording
			? [
					{
						name: 'transcript',
						title: t('meetings.transcript'),
						icon: 'lucide:captions',
						body: transcript
					}
				]
			: []}
	/>
{:else}
	<RecordShell {ctx} of="activities" mode="create" values={view.values} {sections} {fields}>
		{#snippet children()}
			<ActivityCreate {ctx} values={view.values} />
		{/snippet}
	</RecordShell>
{/if}
