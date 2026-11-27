<script lang="ts">
	/**
	 * Auto-save Task workspace:
	 * - Header: single-line constrained breadcrumb flushed to LHS beside History / Fullscreen / Close.
	 * - Record tab: `<Split ratio="wide" size="fill">` with independently scrolling LHS (Title,
	 *   always-editable borderless RichMarkdownEditor, attachments) pinned above a fixed-height
	 *   Sub-tasks panel, and independently scrolling RHS card with collapsible `<Section>` groups.
	 * - Auto-save: always in edit mode when writable; debounced save status lives in the footer.
	 * - Activity tab: polymorphic `<ActivityTimeline>`.
	 */
	import { id_of, type FileRef } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { create_clipboard } from '@norbital-ai/ui/behaviors';
	import { Center, Cluster, Inline, Scroll, Split, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		Badge,
		Button,
		cn,
		enum_text,
		Field,
		type FieldEditor,
		Form,
		Icon,
		Image,
		open_record,
		Picker,
		RecordShell,
		type RecordView,
		RichMarkdownEditor,
		Section,
		Sheet,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Effect, Option, Schema } from 'effect';
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';
	import { toNumber } from '../../../../services/commercial/decimal.js';
	import { STATUS_ICON, STATUS_TONE, formatDateRange } from '../../../../services/ui/task-meta.js';

	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canEditTask = $derived(ctx.catalog?.tasks?.update !== undefined);
	const canCreateTask = $derived(ctx.catalog?.tasks?.create !== undefined);

	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const isReadOnly = $derived(
		record !== null && (view.mode === 'view' || !canEditTask || controller?.historical === true)
	);
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
		return id === null ? null : Option.getOrNull(Schema.decodeUnknownOption(id_of('projects'))(id));
	});
	const isBim = $derived((liveForm?.get('kind') ?? record?.kind) === 'bim');

	const clipboard = create_clipboard({ text: () => record?.task_code ?? '' });

	const projectQuery = $derived(
		record
			? ctx.query({
					projects: {
						where: { id: { eq: record.project_id } },
						fields: ['project_name', 'project_number'],
						limit: 1
					}
				})
			: null
	);
	const projectRef = $derived(projectQuery?.current?.projects.rows[0] ?? null);

	const wbsFamilyQuery = $derived(
		record && record.wbs_path?.trim()
			? ctx.query({
					tasks: {
						where: { project_id: { eq: record.project_id } },
						fields: [
							'task_code',
							'wbs_path',
							'title',
							'status',
							'priority',
							'progress_pct',
							'trade_specialty',
							'is_milestone'
						],
						order_by: { wbs_path: 'asc' },
						limit: 300
					}
				})
			: null
	);

	type WbsTaskRow = NonNullable<typeof wbsFamilyQuery>['current'] extends infer A
		? A extends { tasks: { rows: readonly (infer R)[] } }
			? R
			: never
		: never;

	const parentWbsPath = $derived.by(() => {
		const path = record?.wbs_path?.trim() ?? '';
		const dot = path.lastIndexOf('.');
		return dot > 0 ? path.slice(0, dot) : null;
	});
	const parentTask = $derived<WbsTaskRow | null>(
		parentWbsPath
			? ((wbsFamilyQuery?.current?.tasks.rows ?? []).find(
					(r) => r.wbs_path?.trim() === parentWbsPath && r.id !== record?.id
				) ?? null)
			: null
	);
	const subTasks = $derived.by<readonly WbsTaskRow[]>(() => {
		const path = record?.wbs_path?.trim();
		if (!path) return [];
		const prefix = `${path}.`;
		return (wbsFamilyQuery?.current?.tasks.rows ?? []).filter(
			(r) => r.id !== record?.id && (r.wbs_path?.trim() ?? '').startsWith(prefix)
		);
	});
	const subTasksDone = $derived(subTasks.filter((r) => r.status === 'done').length);

	let subTasksOpen = $state(true);
	let subtaskSheetOpen = $state(false);

	const isFileRef = (value: unknown): value is FileRef =>
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'string' &&
		'name' in value &&
		typeof value.name === 'string' &&
		'mime' in value &&
		typeof value.mime === 'string' &&
		'size' in value &&
		typeof value.size === 'number';

	const uploadDescriptionImage = (file: File) =>
		ctx.upload(file, 'tasks.attachments').pipe(
			Effect.tap((ref) =>
				Effect.sync(() => {
					if (!liveForm) return;
					const existing = liveForm.get('attachments');
					const kept = Array.isArray(existing) ? existing.filter(isFileRef) : [];
					liveForm.set('attachments', [...kept, ref]);
				})
			),
			Effect.map((ref) => ctx.file_url(ref))
		);

	const formatPeriod = (
		range: { readonly from?: string | null; readonly to?: string | null } | null | undefined
	) => formatDateRange(range, ctx.locale);

	const isDateRange = (
		value: unknown
	): value is { readonly from?: string | null; readonly to?: string | null } =>
		typeof value === 'object' && value !== null && ('from' in value || 'to' in value);

	const visibleAttachments = $derived(
		(record?.attachments ?? []).filter((f) => !(record?.description ?? '').includes(f.id))
	);
	const nextChildWbs = $derived(
		record?.wbs_path?.trim() ? `${record.wbs_path.trim()}.${subTasks.length + 1}` : undefined
	);
	const draftTitle = $derived(
		typeof liveForm?.get('title') === 'string'
			? String(liveForm.get('title'))
			: (record?.title ?? '')
	);
	const draftDescription = $derived(
		typeof liveForm?.get('description') === 'string'
			? String(liveForm.get('description'))
			: (record?.description ?? '')
	);
	const titleError = $derived(liveForm?.field_errors.get('title'));

	const propertiesSummary = $derived.by(() => {
		const rawStatus = liveForm?.get('status') ?? record?.status;
		const rawPriority = liveForm?.get('priority') ?? record?.priority;
		const rawProgress = liveForm?.get('progress_pct') ?? record?.progress_pct;
		const parts: string[] = [];
		if (typeof rawStatus === 'string') {
			parts.push(enum_text(rawStatus, { t: rawT, model: 'tasks', field: 'status' }));
		}
		if (typeof rawPriority === 'string') {
			parts.push(enum_text(rawPriority, { t: rawT, model: 'tasks', field: 'priority' }));
		}
		if (
			rawProgress != null &&
			(typeof rawProgress === 'string' || typeof rawProgress === 'number')
		) {
			parts.push(`${Math.round(toNumber(rawProgress))}%`);
		}
		return parts.join(' · ') || undefined;
	});

	const scheduleSummary = $derived.by(() => {
		const rawPlanned = liveForm?.get('schedule_range') ?? record?.schedule_range;
		const planned = isDateRange(rawPlanned) ? formatPeriod(rawPlanned) : null;
		return planned ?? undefined;
	});

	const programmeSummary = $derived.by(() => {
		const rawKind = liveForm?.get('kind') ?? record?.kind;
		const rawCode = liveForm?.get('task_code') ?? record?.task_code;
		const parts: string[] = [];
		if (typeof rawKind === 'string') {
			parts.push(enum_text(rawKind, { t: rawT, model: 'tasks', field: 'kind' }));
		}
		if (typeof rawCode === 'string' && rawCode.trim() !== '') {
			parts.push(rawCode.trim());
		}
		return parts.join(' · ') || undefined;
	});
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

{#snippet taskHeader()}
	{#if record !== null}
		<nav
			aria-label={t('models.tasks.singular')}
			class="flex w-full max-w-2xl min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
		>
			<Button
				variant="ghost"
				class="max-w-44 min-w-0 shrink justify-start px-1.5"
				hint={projectRef?.project_name ?? t('models.tasks.fields.project_id')}
				onclick={() => open_record('projects', record.project_id)}
			>
				<Icon name="lucide:building-2" class="size-3.5 shrink-0 text-muted-foreground" />
				<span class="truncate">
					{projectRef?.project_name ?? t('models.tasks.fields.project_id')}
				</span>
			</Button>
			{#if parentTask !== null}
				<Icon name="lucide:chevron-right" class="size-3 shrink-0 text-muted-foreground" />
				<Button
					variant="ghost"
					class="max-w-60 min-w-0 shrink justify-start px-1.5"
					hint={`${parentTask.task_code} ${parentTask.title}`}
					onclick={() => open_record('tasks', parentTask.id)}
				>
					<span class="shrink-0 font-mono text-xs text-muted-foreground">
						{parentTask.task_code}
					</span>
					<span class="truncate">{parentTask.title}</span>
				</Button>
			{/if}
			<Icon name="lucide:chevron-right" class="size-3 shrink-0 text-muted-foreground" />
			<span class="shrink-0 px-1 font-mono text-label text-foreground">{record.task_code}</span>
			{#if record.wbs_path}
				<span class="shrink-0 font-mono text-tiny text-muted-foreground">
					{t('tasks.wbs_prefix', { path: record.wbs_path })}
				</span>
			{/if}
			{#if record.is_milestone}
				<Badge variant="warning" class="shrink-0 whitespace-nowrap text-tiny">
					<Icon name="lucide:diamond" class="size-2.5" />
					{t('timeline.milestone_badge')}
				</Badge>
			{/if}
			{#if record.kind === 'bim' && (record.bim_express_ids?.length ?? 0) > 0}
				<Badge variant="outline" class="shrink-0 whitespace-nowrap font-mono text-tiny">
					<Icon name="lucide:box" class="size-2.5" />
					{t('tasks.bim_linked_count', { count: record.bim_express_ids?.length ?? 0 })}
				</Badge>
			{/if}
		</nav>
	{/if}
{/snippet}

{#snippet copyCodeAction()}
	{#if record !== null}
		<Button
			size="icon"
			variant="ghost"
			aria-label={t('tasks.copy_code')}
			hint={clipboard.copied ? t('tasks.copied_code') : t('tasks.copy_code')}
			onclick={() => void clipboard.copy()}
		>
			<Icon name={clipboard.copied ? 'lucide:check' : 'lucide:copy'} class="size-3.5" />
		</Button>
	{/if}
{/snippet}

{#snippet mainCanvas()}
	<Stack gap="none" size="fill">
		<Scroll name={t('models.tasks.fields.description')} size="fill" class="pe-2">
			<Center measure="wide" class="py-1">
				<Stack gap="md">
					{#if isReadOnly && record !== null}
						<h1 class="text-title text-foreground">{record.title}</h1>
					{:else}
						<Stack gap="xs">
							<input
								type="text"
								value={draftTitle}
								placeholder={t('models.tasks.fields.title')}
								aria-label={t('models.tasks.fields.title')}
								aria-invalid={titleError !== undefined ? 'true' : undefined}
								class="w-full bg-transparent text-title text-foreground outline-none placeholder:text-muted-foreground"
								oninput={(e) => liveForm?.set('title', e.currentTarget.value)}
							/>
							{#if titleError}
								<p role="alert" class="text-xs text-destructive">{titleError}</p>
							{/if}
						</Stack>
					{/if}

					<RichMarkdownEditor
						value={draftDescription}
						readonly={isReadOnly}
						autofocus={record === null}
						placeholder={t('tasks.description_placeholder')}
						aria-label={t('models.tasks.fields.description')}
						upload={uploadDescriptionImage}
						on_change={(next) => liveForm?.set('description', next === '' ? null : next)}
					/>

					{#if visibleAttachments.length > 0}
						<Cluster gap="xs">
							{#each visibleAttachments as file (file.id)}
								<a href={ctx.file_url(file)} target="_blank" rel="noopener" title={file.name}>
									<Surface tone="card" padding="xs" radius="control" interactive>
										<Inline gap="xs" align="center">
											{#if file.mime.startsWith('image/')}
												<Image
													src={ctx.file_url(file, { preview: 512 })}
													alt={file.name}
													class="size-7 rounded-badge border border-border"
													image_class="object-cover"
												/>
											{:else}
												<Icon name="lucide:paperclip" class="size-3.5 text-muted-foreground" />
											{/if}
											<span class="max-w-44 truncate text-xs text-foreground">{file.name}</span>
										</Inline>
									</Surface>
								</a>
							{/each}
						</Cluster>
					{/if}
				</Stack>
			</Center>
		</Scroll>

		{#if record !== null && (subTasks.length > 0 || (record.wbs_path && canCreateTask))}
			<div class="shrink-0 border-t border-border pt-3">
				<Stack gap="xs">
					<Cluster align="center" justify="between" gap="xs">
						<Button variant="ghost" onclick={() => (subTasksOpen = !subTasksOpen)}>
							<Icon
								name={subTasksOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
								class="size-3.5"
							/>
							<span>{t('tasks.sub_tasks')}</span>
							<span class="font-mono text-xs tabular-nums text-muted-foreground">
								{`${subTasksDone}/${subTasks.length}`}
							</span>
						</Button>
						{#if canCreateTask}
							<Button
								size="icon"
								variant="ghost"
								aria-label={t('tasks.add_sub_task')}
								hint={t('tasks.add_sub_task')}
								onclick={() => (subtaskSheetOpen = true)}
							>
								<Icon name="lucide:plus" class="size-3.5" />
							</Button>
						{/if}
					</Cluster>
					{#if subTasksOpen}
						<Surface
							tone="card"
							padding="none"
							radius="control"
							class="flex h-44 min-h-0 flex-col overflow-hidden"
						>
							{#if subTasks.length > 0}
								<Scroll name={t('tasks.sub_tasks')} size="fill">
									<Stack gap="none" divided>
										{#each subTasks as sub (sub.id)}
											<button
												type="button"
												class="w-full px-3 py-2 text-left transition-colors hover:bg-muted"
												onclick={() => open_record('tasks', sub.id)}
											>
												<Inline align="center" justify="between" gap="sm">
													<Inline align="center" gap="sm">
														<Icon
															name={STATUS_ICON[sub.status]}
															class={cn('size-3.5 shrink-0', STATUS_TONE[sub.status])}
														/>
														<span class="font-mono text-xs text-muted-foreground">
															{sub.task_code}
														</span>
														<span class="truncate text-label">{sub.title}</span>
													</Inline>
													<Inline align="center" gap="sm">
														<span class="text-meta">
															{enum_text(sub.trade_specialty, {
																t: rawT,
																model: 'tasks',
																field: 'trade_specialty'
															})}
														</span>
														<span class="font-mono text-xs tabular-nums text-muted-foreground">
															{`${Math.round(toNumber(sub.progress_pct))}%`}
														</span>
													</Inline>
												</Inline>
											</button>
										{/each}
									</Stack>
								</Scroll>
							{:else}
								<Inline align="center" justify="center" size="fill" class="px-4 text-meta">
									<span>{t('tasks.no_sub_tasks')}</span>
								</Inline>
							{/if}
						</Surface>
					{/if}
				</Stack>
			</div>
		{/if}
	</Stack>
{/snippet}

{#snippet propertiesSidebar()}
	<Surface
		tone="card"
		padding="none"
		radius="control"
		class="flex h-full min-h-0 flex-col overflow-hidden"
	>
		<Scroll name={t('section.task_properties')} size="fill" class="p-4">
			<Stack gap="md">
				<Section
					first
					name="task_properties"
					title={t('section.task_properties')}
					icon="lucide:sliders-horizontal"
					{...propertiesSummary ? { summary: propertiesSummary } : {}}
					actions={copyCodeAction}
				>
					<Stack gap="sm">
						{#if record !== null}
							<Field {ctx} name="status" />
						{/if}
						<Field {ctx} name="priority" />
						<Field {ctx} name="progress_pct" />
						<Field {ctx} name="assignee" />
						<Field {ctx} name="subcontractor_id" />
						<Field {ctx} name="trade_specialty" />
						<Field {ctx} name="zone" />
					</Stack>
				</Section>

				<Section
					name="task_schedule"
					title={t('tasks.group_schedule')}
					icon="lucide:calendar-range"
					{...scheduleSummary ? { summary: scheduleSummary } : {}}
				>
					<Stack gap="sm">
						<Field {ctx} name="schedule_range" />
						<Field {ctx} name="actual_range" />
						<Field {ctx} name="baseline_range" />
					</Stack>
				</Section>

				<Section
					name="task_programme"
					title={t('tasks.group_programme')}
					icon="lucide:boxes"
					{...programmeSummary ? { summary: programmeSummary } : {}}
				>
					<Stack gap="sm">
						<Field {ctx} name="kind" />
						<Field {ctx} name="is_milestone" />
						<Field {ctx} name="task_code" />
						<Field {ctx} name="wbs_path" help={t('tasks.wbs_path_help')} />
						<Field {ctx} name="external_id" />
						<Field {ctx} name="contract_id" editor={contractEditor} />
						{#if !hideProject}
							<Field {ctx} name="project_id" />
						{/if}
						<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
						{#if isBim}
							<Field {ctx} name="bim_express_ids" />
						{/if}
					</Stack>
				</Section>
			</Stack>
		</Scroll>
	</Surface>
{/snippet}

{#snippet twoPaneBody()}
	<Split
		ratio="wide"
		collapse="stack"
		gap="lg"
		size="fill"
		start={mainCanvas}
		end={propertiesSidebar}
	/>
{/snippet}

{#snippet activityTab()}
	{#if record}
		<ActivityTimeline {ctx} about={{ model: 'tasks', id: record.id }} />
	{/if}
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="tasks"
		mode={view.mode}
		id={record.id}
		title={record.task_code}
		eyebrow={false}
		auto_save
		header={taskHeader}
		tabs={[
			{
				name: 'activity',
				title: t('tasks.tab_activity'),
				icon: 'lucide:activity',
				body: activityTab
			}
		]}
	>
		<Form {ctx} of="tasks" mode={view.mode} id={record.id} {record} size="fill">
			{@render twoPaneBody()}
		</Form>
	</RecordShell>
	<Sheet open={subtaskSheetOpen} on_open_change={(open) => !open && (subtaskSheetOpen = false)}>
		{#if subtaskSheetOpen}
			<RecordShell
				{ctx}
				of="tasks"
				mode="create"
				values={{
					project_id: record.project_id,
					kind: record.kind,
					trade_specialty: record.trade_specialty,
					...(nextChildWbs ? { wbs_path: nextChildWbs } : {}),
					...(record.zone ? { zone: record.zone } : {})
				}}
				on_done={() => (subtaskSheetOpen = false)}
			/>
		{/if}
	</Sheet>
{:else if view.mode === 'create'}
	<RecordShell {ctx} of="tasks" mode="create" values={view.values}>
		<Form {ctx} of="tasks" mode="create" values={view.values} size="fill">
			{@render twoPaneBody()}
		</Form>
	</RecordShell>
{/if}
