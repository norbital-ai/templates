<script lang="ts">
	/**
	 * Linear-inspired Task workspace:
	 * - Record tab: `<Split ratio="wide">` with a full-height borderless auto-focused Markdown canvas
	 *   (bubble menu + `/` slash commands, inline image uploads into `attachments`) and collapsible WBS
	 *   sub-tasks on the left; always-open Properties, Schedule & Programme/4D BIM rail on the right.
	 * - Activity tab: polymorphic `<ActivityTimeline>` (title, plain description, timestamp, optional docs).
	 */
	import { id_of, type FileRef, type Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { create_clipboard } from '@norbital-ai/ui/behaviors';
	import { Center, Cluster, Inline, Split, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		Badge,
		Button,
		cn,
		Combobox,
		enum_text,
		Field,
		type FieldEditor,
		Form,
		Icon,
		Image,
		open_record,
		Picker,
		Progress,
		ReadonlyMarkdown,
		RecordForm,
		RecordShell,
		type RecordView,
		RichMarkdownEditor,
		Sheet,
		use_act,
		use_record_controller,
		type ComboboxOption
	} from '@norbital-ai/ui';
	import { Effect, Option, Schema } from 'effect';
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';
	import { TRADE_SPECIALTIES, type TradeSpecialty } from '../../../../lib/trades.js';
	import { toNumber } from '../../../../services/commercial/decimal.js';
	import {
		PRIORITY_ICON,
		PRIORITY_TONE,
		STATUS_ICON,
		STATUS_TONE,
		STATUS_TRANSITIONS,
		formatDateRange,
		type TaskPriority,
		type TaskStatus
	} from '../../../../services/ui/task-meta.js';

	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const record = $derived(view.mode !== 'create' ? view.record : null);
	const isViewMode = $derived(view.mode === 'view' && record !== null);
	const canEditTask = $derived(ctx.catalog?.tasks?.update !== undefined);
	const canCreateTask = $derived(ctx.catalog?.tasks?.create !== undefined);

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
		return id === null ? null : Option.getOrNull(Schema.decodeUnknownOption(id_of('projects'))(id));
	});
	const isBim = $derived((liveForm?.get('kind') ?? record?.kind) === 'bim');

	const clipboard = create_clipboard({ text: () => record?.task_code ?? '' });

	const refsQuery = $derived(
		record &&
			ctx.query({
				projects: {
					where: { id: { eq: record.project_id } },
					fields: ['project_name', 'project_number'],
					limit: 1
				},
				...(record.contract_id
					? {
							contracts: {
								where: { id: { eq: record.contract_id } },
								fields: ['contract_number', 'title'],
								limit: 1
							}
						}
					: {}),
				...(record.assignee
					? {
							sys_user: {
								where: { id: { eq: record.assignee } },
								fields: ['name'],
								limit: 1
							}
						}
					: {}),
				...(record.subcontractor_id
					? {
							contacts: {
								where: { id: { eq: record.subcontractor_id } },
								fields: ['full_name', 'company_name'],
								limit: 1
							}
						}
					: {})
			})
	);

	const projectRef = $derived(refsQuery?.current?.projects.rows[0] ?? null);
	const contractRef = $derived(refsQuery?.current?.contracts?.rows[0] ?? null);
	const assigneeRef = $derived(refsQuery?.current?.sys_user?.rows[0] ?? null);
	const subcontractorRef = $derived(refsQuery?.current?.contacts?.rows[0] ?? null);

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

	const statusOptions = $derived<readonly ComboboxOption<TaskStatus>[]>(
		STATUS_TRANSITIONS[record?.status ?? 'todo'].map((s) => ({
			value: s,
			label: enum_text(s, { t: rawT, model: 'tasks', field: 'status' }),
			icon: STATUS_ICON[s]
		}))
	);
	const priorityOptions = $derived<readonly ComboboxOption<TaskPriority>[]>(
		(['low', 'medium', 'high', 'critical'] as const).map((p) => ({
			value: p,
			label: enum_text(p, { t: rawT, model: 'tasks', field: 'priority' }),
			icon: PRIORITY_ICON[p]
		}))
	);
	const tradeOptions = $derived<readonly ComboboxOption<TradeSpecialty>[]>(
		TRADE_SPECIALTIES.map((tr) => ({
			value: tr,
			label: enum_text(tr, { t: rawT, model: 'tasks', field: 'trade_specialty' })
		}))
	);

	const quickAct = use_act(ctx);
	function patchTask(
		set: Partial<{
			status: TaskStatus;
			priority: TaskPriority;
			trade_specialty: TradeSpecialty;
			assignee: Id<'sys_user'> | null;
			subcontractor_id: Id<'contacts'> | null;
		}>
	): void {
		if (!record || !canEditTask || quickAct.pending) return;
		quickAct.run(
			ctx.act({
				'tasks.update': [{ target: { id: record.id, revision: record.revision }, set }]
			})
		);
	}

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

	const progressNum = $derived(Math.round(toNumber(record?.progress_pct ?? 0)));
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

{#snippet mainCanvas()}
	<Center measure="wide" class="flex min-h-full flex-col">
		<Stack gap="md" class="flex-1">
			{#if record !== null}
				<Cluster gap="xs" align="center">
					<Button variant="ghost" onclick={() => open_record('projects', record.project_id)}>
						<Icon name="lucide:building-2" class="size-3.5 text-muted-foreground" />
						{projectRef?.project_name ?? t('models.tasks.fields.project_id')}
					</Button>
					{#if parentTask !== null}
						<Icon name="lucide:chevron-right" class="size-3 text-muted-foreground" />
						<Button variant="ghost" onclick={() => open_record('tasks', parentTask.id)}>
							<span class="font-mono text-xs text-muted-foreground">{parentTask.task_code}</span>
							<span class="truncate">{parentTask.title}</span>
						</Button>
					{/if}
					<Icon name="lucide:chevron-right" class="size-3 text-muted-foreground" />
					<span class="font-mono text-xs text-foreground">{record.task_code}</span>
					{#if record.wbs_path}
						<span class="font-mono text-tiny text-muted-foreground">
							{t('tasks.wbs_prefix', { path: record.wbs_path })}
						</span>
					{/if}
					{#if record.is_milestone}
						<Badge variant="warning" class="text-tiny">
							<Icon name="lucide:diamond" class="size-2.5" />
							{t('timeline.milestone_badge')}
						</Badge>
					{/if}
					{#if record.kind === 'bim' && (record.bim_express_ids?.length ?? 0) > 0}
						<Badge variant="outline" class="font-mono text-tiny">
							<Icon name="lucide:box" class="size-2.5" />
							{t('tasks.bim_linked_count', { count: record.bim_express_ids?.length ?? 0 })}
						</Badge>
					{/if}
				</Cluster>
			{/if}

			{#if isViewMode && record !== null}
				<Stack gap="md" class="flex-1">
					<h1 class="text-title text-foreground">{record.title}</h1>
					{#if record.description?.trim()}
						{#if canEditTask && liveForm}
							<div
								role="button"
								tabindex="0"
								class="min-h-48 flex-1 cursor-text"
								onclick={() => liveForm?.edit()}
								onkeydown={(e) => {
									if (e.key === 'Enter') liveForm?.edit();
								}}
							>
								<ReadonlyMarkdown value={record.description} class="text-sm leading-normal" />
							</div>
						{:else}
							<ReadonlyMarkdown value={record.description} class="text-sm leading-normal" />
						{/if}
					{:else if canEditTask && liveForm}
						<button
							type="button"
							class="min-h-48 flex-1 cursor-text text-left text-sm text-muted-foreground"
							onclick={() => liveForm?.edit()}
						>
							{t('tasks.add_description_hint')}
						</button>
					{:else}
						<p class="text-meta">{t('tasks.add_description_hint')}</p>
					{/if}
				</Stack>

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
			{:else}
				<Stack gap="md" class="flex-1">
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
					<RichMarkdownEditor
						value={draftDescription}
						autofocus
						placeholder={t('tasks.description_placeholder')}
						aria-label={t('models.tasks.fields.description')}
						upload={uploadDescriptionImage}
						on_change={(next) => liveForm?.set('description', next === '' ? null : next)}
					/>
				</Stack>
			{/if}

			{#if record !== null && (subTasks.length > 0 || (record.wbs_path && canCreateTask))}
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
					{#if subTasksOpen && subTasks.length > 0}
						<Surface tone="card" padding="none" radius="control">
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
												<span class="font-mono text-xs text-muted-foreground">{sub.task_code}</span>
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
						</Surface>
					{/if}
				</Stack>
			{/if}
		</Stack>
	</Center>
{/snippet}

{#snippet propertiesSidebar()}
	<Surface tone="card" padding="md" radius="control">
		<Stack gap="md" divided>
			<Stack gap="sm">
				<Cluster align="center" justify="between" gap="xs">
					<span class="text-overline">{t('section.task_properties')}</span>
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
				</Cluster>

				{#if isViewMode && record !== null}
					{@const curStatus = record.status}
					{@const curPriority = record.priority}
					<Stack gap="xs">
						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_status')}</span>
							{#if canEditTask}
								<Combobox
									options={statusOptions}
									value={curStatus}
									variant="ghost"
									searchable={false}
									disabled={quickAct.pending}
									on_change={(next) => {
										if (next && next !== curStatus) patchTask({ status: next });
									}}
								/>
							{:else}
								<Inline gap="xs" align="center" justify="end">
									<Icon
										name={STATUS_ICON[curStatus]}
										class={cn('size-3.5', STATUS_TONE[curStatus])}
									/>
									<span class="text-xs">
										{enum_text(curStatus, { t: rawT, model: 'tasks', field: 'status' })}
									</span>
								</Inline>
							{/if}
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_priority')}</span>
							{#if canEditTask}
								<Combobox
									options={priorityOptions}
									value={curPriority}
									variant="ghost"
									searchable={false}
									disabled={quickAct.pending}
									on_change={(next) => {
										if (next && next !== curPriority) patchTask({ priority: next });
									}}
								/>
							{:else}
								<Inline gap="xs" align="center" justify="end">
									<Icon
										name={PRIORITY_ICON[curPriority]}
										class={cn('size-3.5', PRIORITY_TONE[curPriority])}
									/>
									<span class="text-xs">
										{enum_text(curPriority, { t: rawT, model: 'tasks', field: 'priority' })}
									</span>
								</Inline>
							{/if}
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_progress')}</span>
							<Inline gap="xs" align="center" justify="end">
								<Progress value={progressNum} max={100} class="h-1.5 w-20 shrink-0" />
								<span
									class="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground"
								>
									{`${progressNum}%`}
								</span>
							</Inline>
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('models.tasks.fields.assignee')}</span>
							{#if canEditTask}
								<Picker
									{ctx}
									of="sys_user"
									value={record.assignee ?? null}
									disabled={quickAct.pending}
									on_change={(next) => {
										if (next !== (record.assignee ?? null)) patchTask({ assignee: next });
									}}
								/>
							{:else}
								<span class="truncate text-xs text-foreground">
									{assigneeRef?.name ?? t('component.no_value')}
								</span>
							{/if}
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('models.tasks.fields.subcontractor_id')}</span>
							{#if canEditTask}
								<Picker
									{ctx}
									of="contacts"
									value={record.subcontractor_id ?? null}
									disabled={quickAct.pending}
									on_change={(next) => {
										if (next !== (record.subcontractor_id ?? null))
											patchTask({ subcontractor_id: next });
									}}
								/>
							{:else}
								<span class="truncate text-xs text-foreground">
									{subcontractorRef?.company_name ??
										subcontractorRef?.full_name ??
										t('component.no_value')}
								</span>
							{/if}
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_trade')}</span>
							{#if canEditTask}
								<Combobox
									options={tradeOptions}
									value={record.trade_specialty}
									variant="ghost"
									disabled={quickAct.pending}
									on_change={(next) => {
										if (next && next !== record.trade_specialty)
											patchTask({ trade_specialty: next });
									}}
								/>
							{:else}
								<span class="truncate text-xs text-foreground">
									{enum_text(record.trade_specialty, {
										t: rawT,
										model: 'tasks',
										field: 'trade_specialty'
									})}
								</span>
							{/if}
						</Inline>

						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_zone')}</span>
							<span class="font-mono text-xs text-foreground">
								{record.zone ?? t('component.no_value')}
							</span>
						</Inline>
					</Stack>
				{:else}
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
				{/if}
			</Stack>

			<Stack gap="sm">
				<span class="text-overline">{t('tasks.group_schedule')}</span>
				{#if isViewMode && record !== null}
					<Stack gap="xs">
						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_planned')}</span>
							<span class="font-mono text-xs tabular-nums text-foreground">
								{formatPeriod(record.schedule_range) ?? t('component.no_value')}
							</span>
						</Inline>
						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_actual')}</span>
							<span class="font-mono text-xs tabular-nums text-foreground">
								{formatPeriod(record.actual_range) ?? t('component.no_value')}
							</span>
						</Inline>
						{#if formatPeriod(record.baseline_range)}
							<Inline align="center" justify="between" gap="sm">
								<span class="text-meta shrink-0">{t('tasks.prop_baseline')}</span>
								<span class="font-mono text-xs tabular-nums text-muted-foreground">
									{formatPeriod(record.baseline_range)}
								</span>
							</Inline>
						{/if}
					</Stack>
				{:else}
					<Stack gap="sm">
						<Field {ctx} name="schedule_range" />
						<Field {ctx} name="actual_range" />
						<Field {ctx} name="baseline_range" />
					</Stack>
				{/if}
			</Stack>

			<Stack gap="sm">
				<span class="text-overline">{t('tasks.group_programme')}</span>
				{#if isViewMode && record !== null}
					<Stack gap="xs">
						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('tasks.prop_type')}</span>
							<Cluster gap="xs" justify="end">
								<Badge variant="outline" class="text-tiny">
									{enum_text(record.kind, { t: rawT, model: 'tasks', field: 'kind' })}
								</Badge>
								{#if record.is_milestone}
									<Badge variant="warning" class="text-tiny">{t('timeline.milestone_badge')}</Badge>
								{/if}
							</Cluster>
						</Inline>
						<Inline align="center" justify="between" gap="sm">
							<span class="text-meta shrink-0">{t('models.tasks.fields.task_code')}</span>
							<span class="font-mono text-xs text-foreground">{record.task_code}</span>
						</Inline>
						{#if record.wbs_path}
							<Inline align="center" justify="between" gap="sm">
								<span class="text-meta shrink-0">{t('models.tasks.fields.wbs_path')}</span>
								<span class="font-mono text-xs text-foreground">{record.wbs_path}</span>
							</Inline>
						{/if}
						{#if record.contract_id}
							<Inline align="center" justify="between" gap="sm">
								<span class="text-meta shrink-0">{t('models.tasks.fields.contract_id')}</span>
								<Button
									variant="ghost"
									onclick={() => record.contract_id && open_record('contracts', record.contract_id)}
								>
									{contractRef
										? `${contractRef.contract_number} · ${contractRef.title}`
										: t('models.tasks.fields.contract_id')}
								</Button>
							</Inline>
						{/if}

						{#if record.kind === 'bim' && record.bim_express_ids?.length}
							<Cluster gap="xs">
								{#each record.bim_express_ids.slice(0, 12) as eid (eid)}
									<Badge variant="outline" class="font-mono text-tiny">{`#${eid}`}</Badge>
								{/each}
								{#if record.bim_express_ids.length > 12}
									<span class="font-mono text-xs text-muted-foreground">
										{`+${record.bim_express_ids.length - 12}`}
									</span>
								{/if}
							</Cluster>
						{/if}
					</Stack>
				{:else}
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
				{/if}
			</Stack>
		</Stack>
	</Surface>
{/snippet}

{#snippet twoPaneBody()}
	<Split ratio="wide" collapse="stack" gap="lg" start={mainCanvas} end={propertiesSidebar} />
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
		subtitle={['kind', 'status', 'priority']}
		tabs={[
			{
				name: 'activity',
				title: t('tasks.tab_activity'),
				icon: 'lucide:activity',
				body: activityTab
			}
		]}
	>
		<Form {ctx} of="tasks" mode={view.mode} id={record.id} {record} size="content">
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
{:else}
	<RecordForm {ctx} {view} subtitle={['kind', 'status', 'priority']}>
		{@render twoPaneBody()}
	</RecordForm>
{/if}
