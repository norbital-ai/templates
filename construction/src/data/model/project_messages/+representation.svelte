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
		Section,
		Table,
		Tabs,
		use_act
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'project_messages'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canExtract = $derived(ctx.catalog?.project_messages?.update !== undefined);
	/** What this message updated: the records its extraction wrote, by kind. */
	const made = $derived(
		record &&
			ctx.query({
				tasks: { where: { source_message_id: { eq: record.id } }, aggregate: { count: true } },
				activities: {
					where: { source_message_id: { eq: record.id } },
					aggregate: { count: true }
				},
				contracts: { where: { source_message_id: { eq: record.id } }, aggregate: { count: true } },
				commercial_documents: {
					where: { source_message_id: { eq: record.id } },
					aggregate: { count: true }
				}
			})
	);
	const madeModels = $derived(
		(['tasks', 'activities', 'contracts', 'commercial_documents'] as const).filter(
			(model) => (made?.current?.[model].count ?? 0) > 0
		)
	);
	const extract = use_act(ctx);

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

{#snippet madeTasks()}
	{#if record}
		<Table
			{ctx}
			of="tasks"
			key={`message:${record.id}:tasks`}
			where={{ source_message_id: { eq: record.id } }}
			toolbar={{ new: false, select: false, filter: false, export: false }}
			columns={['task_code', 'title', 'status', 'progress_pct']}
		/>
	{/if}
{/snippet}

{#snippet madeActivities()}
	{#if record}
		<Table
			{ctx}
			of="activities"
			key={`message:${record.id}:activities`}
			where={{ source_message_id: { eq: record.id } }}
			toolbar={{ new: false, select: false, filter: false, export: false }}
			columns={['title', 'occurred_at', 'about', 'description']}
		/>
	{/if}
{/snippet}

{#snippet madeContracts()}
	{#if record}
		<Table
			{ctx}
			of="contracts"
			key={`message:${record.id}:contracts`}
			where={{ source_message_id: { eq: record.id } }}
			toolbar={{ new: false, select: false, filter: false, export: false }}
			columns={['contract_number', 'title', 'direction', 'contract_value', 'status']}
		/>
	{/if}
{/snippet}

{#snippet madeDocuments()}
	{#if record}
		<Table
			{ctx}
			of="commercial_documents"
			key={`message:${record.id}:commercial_documents`}
			where={{ source_message_id: { eq: record.id } }}
			toolbar={{ new: false, select: false, filter: false, export: false }}
			columns={['doc_type', 'external_reference', 'direction', 'subtotal', 'status']}
		/>
	{/if}
{/snippet}

{#snippet headerActions()}
	{#if canExtract && record && record.project_id != null}
		<Button
			variant="outline"
			disabled={extract.pending}
			onclick={() =>
				extract.run(
					ctx.act({
						'project_messages.update': [
							{
								target: { id: record.id, revision: record.revision },
								set: { extraction_status: 'pending' }
							}
						]
					})
				)}
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
>
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
		{...transcriptionLabel ? { summary: transcriptionLabel } : {}}
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
		{...routingSummary ? { summary: routingSummary } : {}}
	>
		<Grid minimum="compact">
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

	{#if record && madeModels.length > 0}
		<Section icon="lucide:list-checks" name="updated" title={ctx.t('updates.created_title')}>
			<Tabs
				level={2}
				tabs={madeModels.map((model) => ({
					name: model,
					title: ctx.t(`models.${model}.label`),
					body: {
						tasks: madeTasks,
						activities: madeActivities,
						contracts: madeContracts,
						commercial_documents: madeDocuments
					}[model]
				}))}
			/>
		</Section>
	{/if}
</RecordForm>
