<script lang="ts">
	/**
	 * A task as a work item, in three tabs: Record (its body, written as it reads with pictures, and its properties),
	 * Activity (what happens on it, one timeline: comments, issues and meetings, by people or filed from messages) and
	 * Documents (the photos and files filed under it). Comments post on their own; an issue or a meeting opens its form.
	 */
	import { id_of, type FileRef } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Cluster, Column, Grid, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		enum_text,
		Field,
		type FieldEditor,
		Form,
		Icon,
		format,
		Image,
		open_record,
		Picker,
		ReadonlyMarkdown,
		RecordForm,
		RecordShell,
		type RecordView,
		RichMarkdownEditor,
		Section,
		Sheet,
		Timeline,
		type TimelineEntry,
		use_act,
		use_record_controller
	} from '@norbital-ai/ui';
	import { create_toggle_group } from '@norbital-ai/ui/behaviors';
	import { Effect, Option, Schema } from 'effect';

	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const linksSummary = $derived(
		record?.bim_express_ids?.length
			? t('tasks.bim_linked_count', { count: record.bim_express_ids.length })
			: undefined
	);

	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const fixedProject = $derived(
		record?.project_id ??
			(view.mode === 'create' && typeof view.values.project_id === 'string'
				? view.values.project_id
				: null)
	);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
	const scopedProject = $derived.by(() => {
		const raw = liveForm?.get('project_id');
		const id = typeof raw === 'string' ? raw : fixedProject;
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('projects'))(id));
	});
	const isBim = $derived((liveForm?.get('kind') ?? record?.kind) === 'bim');

	const activityQuery = $derived(
		record &&
			ctx.query({
				activities: {
					where: { task_id: { eq: record.id } },
					fields: [
						'revision',
						'kind',
						'title',
						'body',
						'attachments',
						'occurred_at',
						'issue_type',
						'severity',
						'status',
						'attendees'
					],
					order_by: { occurred_at: 'asc' },
					limit: 500,
					author: { fields: ['name'] },
					source_message_id: { fields: ['transport', 'sender_name'] }
				}
			})
	);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const label = (field: 'kind' | 'issue_type' | 'severity' | 'status', value: string) =>
		enum_text(value, { t: rawT, model: 'activities', field });
	type ActivityRow = NonNullable<typeof activityQuery>['current'] extends infer A
		? A extends { activities: { rows: readonly (infer R)[] } }
			? R
			: never
		: never;
	type ActivityEntry = TimelineEntry & {
		readonly row: ActivityRow;
		/** What was posted with it and is not already pictured in its body. */
		readonly files: readonly FileRef[];
	};
	/** Which kinds the timeline shows: all, or one. */
	let shown = $state<'all' | 'comment' | 'issue' | 'meeting'>('all');
	const shownGroup = create_toggle_group({
		items: () => ['all', 'comment', 'issue', 'meeting'],
		mode: 'single',
		value: () => [shown],
		on_change: (values) => {
			const next = values[0];
			if (next === 'all' || next === 'comment' || next === 'issue' || next === 'meeting')
				shown = next;
		},
		control: { id: 'construction:task-activity-kind', label: t('tasks.activity_filter') }
	});
	const ICON = {
		comment: 'lucide:message-square',
		issue: 'lucide:triangle-alert',
		meeting: 'lucide:users'
	} as const;
	const activity = $derived<ActivityEntry[]>(
		(activityQuery?.current?.activities.rows ?? [])
			.filter((a) => shown === 'all' || a.kind === shown)
			.map((a) => {
				const message = a.source_message_id;
				const who =
					a.author?.name ??
					(message
						? `${message.sender_name ?? t('tasks.comment_author_unknown')} · ${enum_text(message.transport, { t: rawT, model: 'project_messages', field: 'transport' })}`
						: null);
				const when = format({ kind: 'instant' }, a.occurred_at, { locale: ctx.locale });
				return {
					key: a.id,
					icon: message && a.kind === 'comment' ? 'lucide:message-circle-more' : ICON[a.kind],
					tone:
						a.kind === 'issue' && a.status === 'open' ? ('warning' as const) : ('default' as const),
					title: a.title ?? who ?? t('tasks.comment_author_unknown'),
					line: [
						...(a.kind === 'comment'
							? []
							: [label('kind', a.kind), ...(who === null ? [] : [who])]),
						when,
						...(a.kind === 'issue' && a.issue_type ? [label('issue_type', a.issue_type)] : []),
						...(a.kind === 'meeting' && a.attendees?.length ? [a.attendees.join(', ')] : [])
					],
					...(a.kind === 'issue' && a.severity && a.status
						? {
								mark: {
									text: `${label('severity', a.severity)} · ${label('status', a.status)}`,
									warn: a.status === 'open'
								}
							}
						: {}),
					...(a.kind === 'comment' ? {} : { onpick: () => open_record('activities', a.id) }),
					row: a,
					files: (a.attachments ?? []).filter((file) => !(a.body ?? '').includes(file.id))
				};
			})
	);
	const canUpdate = $derived(ctx.catalog?.activities?.update !== undefined);
	const deciding = use_act(ctx);
	/** Closes an open issue, or opens a closed one again. */
	function toggleIssue(row: ActivityRow): void {
		deciding.run(
			ctx.act({
				'activities.update': [
					{
						target: { id: row.id, revision: row.revision },
						set: { status: row.status === 'open' ? 'closed' : 'open' }
					}
				]
			})
		);
	}
	/** A new issue or meeting opens its form here, filed under this task. */
	let raising = $state<'issue' | 'meeting' | null>(null);
	let draft = $state('');
	let draftFiles = $state<FileRef[]>([]);
	const posting = use_act(ctx);
	const canComment = $derived(ctx.catalog?.activities?.create !== undefined);
	/** A picture in a comment is stored with the comment and shown in place. */
	const keepWithComment = (file: File) =>
		ctx.upload(file, 'activities.attachments').pipe(
			Effect.tap((ref) => Effect.sync(() => (draftFiles = [...draftFiles, ref]))),
			Effect.map((ref) => ctx.file_url(ref))
		);
	function postComment(): void {
		const body = draft.trim();
		if (record === null || body === '') return;
		posting.run(
			ctx.act({
				'activities.create': [
					{
						task_id: record.id,
						kind: 'comment',
						body,
						...(draftFiles.length > 0 ? { attachments: draftFiles } : {})
					}
				]
			}),
			{
				saved: t('tasks.comment_posted'),
				then: () => {
					draft = '';
					draftFiles = [];
				}
			}
		);
	}
</script>

{#snippet contractEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="contracts"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet sourceMessageEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="project_messages"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet entryBody(entry: ActivityEntry)}
	{#if entry.row.body}
		<ReadonlyMarkdown value={entry.row.body} class="text-sm" />
	{/if}
	{#if entry.files.length > 0}
		<Cluster gap="xs">
			{#each entry.files as file (file.id)}
				<a href={ctx.file_url(file)} target="_blank" rel="noopener" title={file.name}>
					{#if file.mime.startsWith('image/')}
						<Image
							src={ctx.file_url(file, { preview: 512 })}
							alt={file.name}
							class="size-16 rounded-inset border border-border"
							image_class="object-cover"
						/>
					{:else}
						<span class="text-meta underline">{file.name}</span>
					{/if}
				</a>
			{/each}
		</Cluster>
	{/if}
{/snippet}

{#snippet main()}
	<Section icon="lucide:list-checks" first name="task" title={t('section.task')}>
		<Grid minimum="card">
			<Column span="all"><Field {ctx} name="title" /></Column>
			<Column span="all"><Field {ctx} name="description" /></Column>
			<Column span="all"><Field {ctx} name="latest_update" /></Column>
		</Grid>
	</Section>
{/snippet}

{#snippet properties()}
	<Stack gap="md">
		<Section
			icon="lucide:sliders-horizontal"
			name="properties"
			title={t('section.task_properties')}
		>
			<Grid minimum="card">
				<Field {ctx} name="kind" />
				{#if record !== null}
					<Field {ctx} name="status" />
				{/if}
				<Field {ctx} name="priority" />
				<Field {ctx} name="assignee" />
				<Field {ctx} name="subcontractor_id" />
				<Field {ctx} name="trade_specialty" />
				<Field {ctx} name="zone" />
				<Field {ctx} name="progress_pct" />
				<Field {ctx} name="schedule_range" />
				<Field {ctx} name="actual_range" />
				<Field {ctx} name="baseline_range" />
				<Field {ctx} name="last_updated_on" />
				<Field {ctx} name="is_milestone" />
				<Field {ctx} name="contract_id" editor={contractEditor} />
				{#if !hideProject}
					<Field {ctx} name="project_id" />
				{/if}
			</Grid>
		</Section>
		<Section
			icon="lucide:link"
			name="programme"
			title={t('section.programme_and_links')}
			default_open={false}
			{...linksSummary ? { summary: linksSummary } : {}}
		>
			<Grid minimum="card">
				<Field {ctx} name="task_code" />
				<Field {ctx} name="wbs_path" help={t('tasks.wbs_path_help')} />
				<Field {ctx} name="external_id" />
				{#if isBim}
					<Column span="all"><Field {ctx} name="bim_express_ids" /></Column>
				{/if}
				<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			</Grid>
		</Section>
	</Stack>
{/snippet}

{#snippet issueToggle(entry: ActivityEntry)}
	{#if entry.row.kind === 'issue' && canUpdate}
		<Button
			variant="ghost"
			class="h-6 px-2 text-micro"
			disabled={deciding.pending}
			onclick={() => toggleIssue(entry.row)}
		>
			{entry.row.status === 'open' ? t('tasks.close_issue') : t('tasks.reopen_issue')}
		</Button>
	{/if}
{/snippet}

{#snippet activityTab()}
	<Stack gap="md">
		<Inline justify="between" align="center" gap="sm">
			<div
				class="inline-flex items-center rounded-control border border-border bg-muted/40 p-0.5"
				{...shownGroup.root_attrs()}
				aria-label={t('tasks.activity_filter')}
			>
				{#each ['all', 'comment', 'issue', 'meeting'] as const as kind (kind)}
					<Button
						{...shownGroup.item_attrs(kind)}
						{@attach shownGroup.item(kind)}
						variant={shown === kind ? 'secondary' : 'ghost'}
						class="h-7 px-2 text-micro"
					>
						{t(`tasks.activity_${kind}`)}
					</Button>
				{/each}
			</div>
			{#if canComment}
				<Inline gap="xs">
					<Button variant="outline" onclick={() => (raising = 'issue')}>
						<Icon name="lucide:triangle-alert" class="size-3.5" />
						{t('tasks.raise_issue')}
					</Button>
					<Button variant="outline" onclick={() => (raising = 'meeting')}>
						<Icon name="lucide:users" class="size-3.5" />
						{t('tasks.log_meeting')}
					</Button>
				</Inline>
			{/if}
		</Inline>
		<Timeline
			entries={activity}
			label={t('tasks.activity_title')}
			item={entryBody}
			trailing={issueToggle}
		>
			{#snippet empty()}
				<p class="text-meta">{t('tasks.no_activity')}</p>
			{/snippet}
		</Timeline>
		{#if canComment}
			<RichMarkdownEditor
				value={draft}
				on_change={(next) => (draft = next)}
				upload={keepWithComment}
				placeholder={t('tasks.comment_placeholder')}
				aria-label={t('tasks.comment_placeholder')}
				disabled={posting.pending}
			/>
			<Inline justify="end">
				<Button
					variant="brand"
					disabled={posting.pending || draft.trim() === ''}
					onclick={postComment}
				>
					{t('tasks.comment_post')}
				</Button>
			</Inline>
		{/if}
	</Stack>
{/snippet}

{#snippet documentsTab()}
	{#if record}
		<Form {ctx} of="tasks" mode={view.mode} id={record.id} {record} size="content">
			<Section icon="lucide:paperclip" first name="documents" title={t('tasks.tab_documents')}>
				<Field {ctx} name="attachments" />
			</Section>
		</Form>
	{/if}
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="tasks"
		mode={view.mode}
		id={record.id}
		subtitle={['kind', 'status', 'priority']}
		tabs={[
			{
				name: 'activity',
				title: t('tasks.tab_activity'),
				icon: 'lucide:activity',
				body: activityTab
			},
			{
				name: 'documents',
				title: t('tasks.tab_documents'),
				icon: 'lucide:paperclip',
				body: documentsTab
			}
		]}
	>
		<Form {ctx} of="tasks" mode={view.mode} id={record.id} {record} size="content">
			<Split ratio="wide" gap="lg" start={main} end={properties} />
		</Form>
	</RecordShell>
	<Sheet open={raising !== null} on_open_change={(open) => !open && (raising = null)}>
		{#if raising !== null}
			<RecordShell
				{ctx}
				of="activities"
				mode="create"
				values={{ task_id: record.id, kind: raising }}
				on_done={() => (raising = null)}
			/>
		{/if}
	</Sheet>
{:else}
	<RecordForm {ctx} {view} subtitle={['kind', 'status', 'priority']}>
		<Split ratio="wide" gap="lg" start={main} end={properties} />
	</RecordForm>
{/if}
