<script lang="ts">
	/**
	 * Auto-save Task workspace:
	 * - Header: single-line constrained breadcrumb flushed to LHS beside History / Fullscreen / Close.
	 * - Record tab: `<Split ratio="wide" size="fill">` with independently scrolling LHS (Title,
	 *   always-editable borderless RichMarkdownEditor, attachments) pinned above a fixed-height
	 *   Sub-tasks panel, and independently scrolling RHS card with simplified Ad hoc / BIM switch,
	 *   visual 3D BIM element tagger, and collapsible `<Section>` groups.
	 * - Auto-save: always in edit mode when writable; debounced save status lives in the footer.
	 * - Activity tab: polymorphic `<ActivityTimeline>`.
	 */
	import { id_of, type FileRef } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { create_clipboard } from '@norbital-ai/ui/behaviors';
	import {
		Bound,
		Center,
		Cluster,
		Inline,
		Scroll,
		Split,
		Stack,
		Surface
	} from '@norbital-ai/ui/layout';
	import {
		Alert,
		Badge,
		Button,
		cn,
		enum_text,
		Field,
		FieldControl,
		type FieldEditor,
		Form,
		Icon,
		Image,
		Input,
		open_record,
		Picker,
		RecordShell,
		type RecordView,
		RichMarkdownEditor,
		Section,
		Sheet,
		Spinner,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Effect, Option, Schema } from 'effect';
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';
	import { toNumber } from '../../../../services/commercial/decimal.js';
	import SegmentedToggle from '../../../../services/ui/SegmentedToggle.svelte';
	import { STATUS_ICON, STATUS_TONE, formatDateRange } from '../../../../services/ui/task-meta.js';
	import type {
		IFCSelectedElement,
		IFCViewerMarkerGroup
	} from '../../../../services/viewer/types.js';

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

	const rawKind = $derived(liveForm?.get('kind') ?? record?.kind ?? 'adhoc');
	const taskKind = $derived<'bim' | 'adhoc'>(rawKind === 'bim' ? 'bim' : 'adhoc');
	const isBim = $derived(taskKind === 'bim');

	const liveExpressIds = $derived.by<readonly number[]>(() => {
		const raw = liveForm?.get('bim_express_ids') ?? record?.bim_express_ids;
		if (!Array.isArray(raw)) return [];
		return raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
	});
	const expressIdSet = $derived(new Set(liveExpressIds));

	const clipboard = create_clipboard({ text: () => record?.task_code ?? '' });

	const projectQuery = $derived(
		scopedProject
			? ctx.query({
					projects: {
						where: { id: { eq: scopedProject } },
						fields: ['project_name', 'project_number', 'bim_file'],
						limit: 1
					}
				})
			: null
	);
	const projectRef = $derived(projectQuery?.current?.projects.rows[0] ?? null);
	const projectBimFile = $derived(projectRef?.bim_file ?? null);
	const projectIfcSrc = $derived(projectBimFile ? ctx.file_url(projectBimFile) : '');

	let bimPickerOpen = $state(false);
	let bimGroupSearch = $state('');

	const bimEstimateQuery = $derived(
		scopedProject && (isBim || bimPickerOpen)
			? ctx.query({
					cost_estimates: {
						where: { project_id: { eq: scopedProject } },
						fields: ['status', 'bim_assets'],
						limit: 1
					}
				})
			: null
	);
	const bimSettingsQuery = $derived(
		bimPickerOpen
			? ctx.query({ bim_settings: { fields: ['code', 'exclude_ifc_classes'], limit: 10 } })
			: null
	);
	const viewerExcludeClasses = $derived.by(() => {
		const rows = bimSettingsQuery?.current?.bim_settings.rows ?? [];
		return (rows.find((r) => r.code === 'default') ?? rows[0])?.exclude_ifc_classes ?? undefined;
	});
	const bimGroups = $derived.by(() => {
		const est = bimEstimateQuery?.current?.cost_estimates.rows[0];
		if (!est || est.status === 'void') return [];
		return (est.bim_assets ?? []).filter((line) => (line.sample_express_ids?.length ?? 0) > 0);
	});
	const filteredBimGroups = $derived.by(() => {
		const q = bimGroupSearch.trim().toLowerCase();
		if (!q) return bimGroups;
		return bimGroups.filter((g) =>
			`${g.classification} ${g.storey} ${g.ifc_class} ${g.matrix_code ?? ''}`
				.toLowerCase()
				.includes(q)
		);
	});
	const matchedGroupLabels = $derived.by(() => {
		if (liveExpressIds.length === 0 || bimGroups.length === 0) return [];
		const labels: string[] = [];
		for (const g of bimGroups) {
			if ((g.sample_express_ids ?? []).some((id) => expressIdSet.has(id))) {
				labels.push(`${g.storey} · ${g.classification}`);
			}
		}
		return labels;
	});

	const pickerViewer = $derived(
		bimPickerOpen && projectBimFile ? import('../../../../services/viewer/IfcViewer.svelte') : null
	);
	const pickerMarkerGroups = $derived<IFCViewerMarkerGroup[]>(
		liveExpressIds.length > 0
			? [
					{
						label: t('tasks.bim_tagged_legend'),
						color: 'var(--color-primary)',
						expressIds: [...liveExpressIds]
					}
				]
			: []
	);

	function setExpressIds(next: readonly number[]) {
		if (isReadOnly || !liveForm) return;
		const unique = [...new Set(next)].sort((a, b) => a - b);
		liveForm.set('bim_express_ids', unique.length > 0 ? unique : null);
	}

	function toggleElementTag(element: IFCSelectedElement) {
		if (expressIdSet.has(element.expressId)) {
			setExpressIds(liveExpressIds.filter((id) => id !== element.expressId));
		} else {
			setExpressIds([...liveExpressIds, element.expressId]);
		}
	}

	function toggleGroupTag(ids: readonly number[]) {
		if (ids.length === 0) return;
		const allTagged = ids.every((id) => expressIdSet.has(id));
		if (allTagged) {
			const drop = new Set(ids);
			setExpressIds(liveExpressIds.filter((id) => !drop.has(id)));
		} else {
			setExpressIds([...liveExpressIds, ...ids]);
		}
	}

	function setTaskKind(next: 'bim' | 'adhoc') {
		if (isReadOnly || !liveForm) return;
		liveForm.set('kind', next);
	}

	const kindOptions = $derived([
		{
			value: 'adhoc' as const,
			label: t('models.tasks.fields.kind.adhoc'),
			icon: 'lucide:list-checks'
		},
		{ value: 'bim' as const, label: t('models.tasks.fields.kind.bim'), icon: 'lucide:box' }
	]);

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
		const rawCode = liveForm?.get('task_code') ?? record?.task_code;
		const rawWbs = liveForm?.get('wbs_path') ?? record?.wbs_path;
		const parts: string[] = [];
		if (typeof rawCode === 'string' && rawCode.trim() !== '') {
			parts.push(rawCode.trim());
		}
		if (typeof rawWbs === 'string' && rawWbs.trim() !== '') {
			parts.push(t('tasks.wbs_prefix', { path: rawWbs.trim() }));
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
			{#if isBim && liveExpressIds.length > 0}
				<Badge variant="outline" class="shrink-0 whitespace-nowrap font-mono text-tiny">
					<Icon name="lucide:box" class="size-2.5" />
					{t('tasks.bim_linked_count', { count: liveExpressIds.length })}
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
						<h1 class="text-heading text-foreground">{record.title}</h1>
					{:else}
						<Stack gap="xs">
							<input
								type="text"
								value={draftTitle}
								placeholder={t('models.tasks.fields.title')}
								aria-label={t('models.tasks.fields.title')}
								aria-invalid={titleError !== undefined ? 'true' : undefined}
								class="w-full bg-transparent text-heading text-foreground outline-none placeholder:text-muted-foreground"
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
								<Inline align="center" justify="center" size="fill" class="text-meta">
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
		<Scroll name={t('section.task_properties')} size="fill" inset>
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
						<FieldControl id="task-kind" label={t('tasks.prop_type')}>
							{#if isReadOnly}
								<Badge variant="outline">
									{enum_text(taskKind, { t: rawT, model: 'tasks', field: 'kind' })}
								</Badge>
							{:else}
								<SegmentedToggle
									options={kindOptions}
									value={taskKind}
									onChange={setTaskKind}
									label={t('tasks.prop_type')}
									control={{ id: 'construction:task-kind', label: t('tasks.prop_type') }}
								/>
							{/if}
						</FieldControl>

						{#if isBim}
							<FieldControl id="task-bim-elements" label={t('tasks.bim_elements_label')}>
								<Surface tone="subtle" padding="xs" radius="control">
									<Stack gap="xs">
										<Cluster align="center" justify="between" gap="xs">
											<Inline gap="xs" align="center">
												<Icon name="lucide:box" class="size-3.5 shrink-0 text-muted-foreground" />
												<span class="text-xs text-foreground">
													{liveExpressIds.length > 0
														? t('tasks.bim_linked_count', { count: liveExpressIds.length })
														: t('tasks.bim_none_tagged')}
												</span>
											</Inline>
											{#if !isReadOnly && liveExpressIds.length > 0}
												<Button
													size="icon"
													variant="ghost"
													aria-label={t('tasks.bim_clear_tags')}
													hint={t('tasks.bim_clear_tags')}
													onclick={() => setExpressIds([])}
												>
													<Icon name="lucide:x" class="size-3.5" />
												</Button>
											{/if}
										</Cluster>
										{#if matchedGroupLabels.length > 0}
											<Cluster gap="xs">
												{#each matchedGroupLabels.slice(0, 3) as lbl (lbl)}
													<Badge variant="outline" class="max-w-full truncate text-tiny"
														>{lbl}</Badge
													>
												{/each}
												{#if matchedGroupLabels.length > 3}
													<Badge variant="outline" class="text-tiny">
														{`+${matchedGroupLabels.length - 3}`}
													</Badge>
												{/if}
											</Cluster>
										{/if}
										{#if projectBimFile}
											<Button variant="outline" onclick={() => (bimPickerOpen = true)}>
												<Icon name="lucide:mouse-pointer-click" class="size-3.5" />
												{isReadOnly ? t('tasks.bim_view_in_3d') : t('tasks.bim_tag_in_3d')}
											</Button>
										{:else}
											<p class="text-micro text-muted-foreground">
												{t('tasks.bim_no_project_model')}
											</p>
										{/if}
									</Stack>
								</Surface>
							</FieldControl>
						{/if}

						{#if !hideProject}
							<Field {ctx} name="project_id" />
						{/if}
						{#if record !== null}
							<Field {ctx} name="status" />
						{/if}
						<Field {ctx} name="priority" />
						<Field {ctx} name="progress_pct" />
						<Field {ctx} name="is_milestone" />
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
						{#if record?.baseline_range != null}
							<Field {ctx} name="baseline_range" />
						{/if}
					</Stack>
				</Section>

				<Section
					name="task_programme"
					title={t('tasks.group_programme')}
					icon="lucide:boxes"
					default_open={false}
					{...programmeSummary ? { summary: programmeSummary } : {}}
				>
					<Stack gap="sm">
						<Field {ctx} name="task_code" />
						<Field {ctx} name="wbs_path" help={t('tasks.wbs_path_help')} />
						<Field {ctx} name="contract_id" editor={contractEditor} />
						{#if record?.source_message_id != null}
							<Field {ctx} name="source_message_id" readonly />
						{/if}
					</Stack>
				</Section>
			</Stack>
		</Scroll>
	</Surface>
{/snippet}

{#snippet bimPickerViewer()}
	<Bound size="fill" min_height="26rem">
		{#if pickerViewer && projectBimFile && projectIfcSrc}
			{#await pickerViewer}
				<Inline align="center" justify="center" size="fill" aria-busy="true">
					<Spinner />
					<span class="text-xs text-muted-foreground">{t('component.loading_viewer')}</span>
				</Inline>
			{:then mod}
				<mod.default
					t={ctx.t}
					src={projectIfcSrc}
					alt={projectBimFile.name}
					initialNavMode="inspect"
					markerGroups={pickerMarkerGroups}
					taggedExpressIds={liveExpressIds}
					{...!isReadOnly ? { onToggleTag: toggleElementTag } : {}}
					{...viewerExcludeClasses ? { excludeClasses: viewerExcludeClasses } : {}}
				/>
			{:catch error}
				<Alert.Root variant="destructive"><Alert.Title>{String(error)}</Alert.Title></Alert.Root>
			{/await}
		{/if}
	</Bound>
{/snippet}

{#snippet bimPickerGroups()}
	<Surface tone="card" padding="sm" radius="control" class="flex h-full min-h-0 flex-col">
		<Stack gap="sm" size="fill">
			<Stack gap="xs">
				<span class="text-label">{t('tasks.bim_groups_title')}</span>
				<span class="text-meta">{t('tasks.bim_groups_hint')}</span>
			</Stack>
			<Input
				bind:value={bimGroupSearch}
				type="search"
				placeholder={t('bim_costing.search_boq')}
				aria-label={t('tasks.bim_groups_title')}
				class="text-xs"
			/>
			<Scroll name={t('tasks.bim_groups_title')} size="fill">
				<Stack gap="xs">
					{#each filteredBimGroups as grp (grp.asset_key)}
						{@const ids = grp.sample_express_ids ?? []}
						{@const taggedCount = ids.filter((id) => expressIdSet.has(id)).length}
						{@const allTagged = ids.length > 0 && taggedCount === ids.length}
						<Surface tone={taggedCount > 0 ? 'subtle' : 'card'} padding="xs" radius="control">
							<Cluster align="center" justify="between" gap="xs">
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-medium text-foreground">{grp.classification}</p>
									<p class="truncate text-micro text-muted-foreground">
										{`${grp.storey} · ${grp.ifc_class} · ${ids.length}`}
									</p>
								</div>
								{#if !isReadOnly}
									<Button
										variant={allTagged ? 'secondary' : 'outline'}
										onclick={() => toggleGroupTag(ids)}
									>
										<Icon name={allTagged ? 'lucide:check' : 'lucide:plus'} class="size-3" />
										{allTagged ? t('tasks.bim_tagged_short') : t('tasks.bim_tag_short')}
									</Button>
								{:else if taggedCount > 0}
									<Badge variant="outline" class="text-tiny">{taggedCount}</Badge>
								{/if}
							</Cluster>
						</Surface>
					{/each}
				</Stack>
			</Scroll>
		</Stack>
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

<Sheet
	open={bimPickerOpen}
	on_open_change={(open) => !open && (bimPickerOpen = false)}
	title={t('tasks.bim_picker_title')}
	memory="construction:task-bim-picker"
>
	{#if bimPickerOpen}
		<Bound size="fill" inset>
			<Stack gap="sm" size="fill">
				<Cluster align="center" justify="between" gap="sm">
					<Inline gap="xs" align="center">
						<Badge variant="outline" class="font-mono text-tiny">
							{t('tasks.bim_linked_count', { count: liveExpressIds.length })}
						</Badge>
						<span class="text-meta">{t('tasks.bim_picker_hint')}</span>
					</Inline>
					<Cluster gap="xs">
						{#if !isReadOnly && liveExpressIds.length > 0}
							<Button variant="ghost" onclick={() => setExpressIds([])}>
								{t('tasks.bim_clear_tags')}
							</Button>
						{/if}
						<Button variant="brand" onclick={() => (bimPickerOpen = false)}>
							<Icon name="lucide:check" class="size-3.5" />
							{t('tasks.bim_picker_done')}
						</Button>
					</Cluster>
				</Cluster>
				{#if bimGroups.length > 0}
					<Split
						size="fill"
						ratio="wide"
						collapse="stack"
						gap="md"
						start={bimPickerViewer}
						end={bimPickerGroups}
					/>
				{:else}
					{@render bimPickerViewer()}
				{/if}
			</Stack>
		</Bound>
	{/if}
</Sheet>
