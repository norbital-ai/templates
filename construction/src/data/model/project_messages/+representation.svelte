<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		enum_text,
		Field,
		Icon,
		RecordForm,
		type RecordView,
		RunStatus,
		Section,
		use_act
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'project_messages'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canExtract = $derived(ctx.catalog?.project_messages?.update !== undefined);
	const extract = use_act(ctx);
	let lastRunId = $state<string | null>(null);

	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const transcriptionLabel = $derived(
		record?.transcription && record.transcription !== 'none'
			? enum_text(record.transcription, {
					t: rawT,
					model: 'project_messages',
					field: 'transcription'
				})
			: undefined
	);
	const routingSummary = $derived(
		record
			? `${enum_text(record.classification, {
					t: rawT,
					model: 'project_messages',
					field: 'classification'
				})} · ${enum_text(record.extraction_status, {
					t: rawT,
					model: 'project_messages',
					field: 'extraction_status'
				})}`
			: undefined
	);
</script>

{#snippet headerActions()}
	{#if canExtract && record && record.project_id != null}
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
		<Grid minimum="card">
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
		{...transcriptionLabel ? { summary: transcriptionLabel } : {}}
	>
		<Stack gap="sm">
			<Field {ctx} name="attachments" />
			<Grid minimum="card">
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
		{...routingSummary ? { summary: routingSummary } : {}}
	>
		<Grid minimum="card">
			<Field {ctx} name="classification" />
			{#if record?.classified_by != null}
				<Field {ctx} name="classified_by" readonly />
			{/if}
			<Field {ctx} name="extraction_status" />
			{#if record?.extracted_at != null}
				<Field {ctx} name="extracted_at" readonly />
			{/if}
			<Column span="all"><Field {ctx} name="reason" /></Column>
			{#if record?.extraction_summary}
				<Column span="all"><Field {ctx} name="extraction_summary" readonly /></Column>
			{/if}
		</Grid>
	</Section>
</RecordForm>
