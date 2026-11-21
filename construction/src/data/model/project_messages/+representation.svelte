<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Field,
		Icon,
		RunStatus,
		Section,
		use_act,
		type RecordView
	} from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'project_messages'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const extract = use_act(ctx);
	let lastRunId = $state<string | null>(null);
</script>

{#snippet headerActions()}
	{#if record && record.project_id != null}
		<Button
			variant="outline"
			disabled={extract.pending}
			onclick={() =>
				extract.run(ctx.run('extract_project_updates', { message_ids: [record.id] }), {
					then: (handle) => {
						lastRunId = handle.output.id;
					}
				})}
		>
			<Icon name="lucide:wand-sparkles" class="size-3.5" />
			{ctx.t('messages.reextract_now')}
		</Button>
	{/if}
{/snippet}

<RecordForm
	{ctx}
	{view}
	subtitle={['transport', 'sender_name', 'classification']}
	actions={headerActions}
	{...record ? { runs: [{ ctx, automation: 'extract_project_updates', limit: 5 }] } : {}}
>
	{#if lastRunId}
		<RunStatus {ctx} automation="extract_project_updates" run={lastRunId} />
	{/if}

	<Section icon="lucide:message-square-text" first name="message" title={ctx.t('section.message')}>
		<Grid minimum="compact">
			<Field {ctx} name="subject" />
			<Field {ctx} name="transport" />
			<Field {ctx} name="direction" />
			<Field {ctx} name="sender_name" />
			<Field {ctx} name="handle" />
			<Field {ctx} name="occurred_at" />
			<Field {ctx} name="project_id" />
			<Field {ctx} name="contact_id" />
			<Column span="all"><Field {ctx} name="detail" /></Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:paperclip"
		name="media"
		title={ctx.t('section.attachments_and_voice')}
		default_open={false}
		{...record?.transcription && record.transcription !== 'none'
			? { summary: record.transcription }
			: {}}
	>
		<Stack gap="sm">
			<Field {ctx} name="attachments" />
			<Grid minimum="compact">
				<Field {ctx} name="recording" />
				<Field {ctx} name="transcription" />
				{#if record?.transcription_error}
					<Column span="all"><Field {ctx} name="transcription_error" readonly /></Column>
				{/if}
			</Grid>
		</Stack>
	</Section>

	<Section
		icon="lucide:sparkles"
		name="routing"
		title={ctx.t('section.routing_and_extraction')}
		default_open={false}
		{...record ? { summary: `${record.classification} · ${record.extraction_status}` } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="classification" />
			<Field {ctx} name="classified_by" readonly />
			<Field {ctx} name="extraction_status" />
			<Field {ctx} name="extracted_at" readonly />
			<Column span="all"><Field {ctx} name="reason" /></Column>
			<Column span="all"><Field {ctx} name="extraction_summary" readonly /></Column>
		</Grid>
	</Section>
</RecordForm>
