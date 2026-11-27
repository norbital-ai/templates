<script lang="ts">
	/**
	 * Project Hub → BIM tab:
	 * 1. `3D Model & Tasks` — live 3D IFC viewer + linked BIM tasks.
	 * 2. `BIM Costing` — clear Cost Estimate overview (or durable progress-aware EmptyState when no
	 *    estimate exists yet) with an in-place tunneled 3-step workflow (`← Back` anytime without
	 *    losing progress):
	 *    - Step 1: Parse & Analyze Model (no premature review tables or buttons).
	 *    - Step 2: Review Proposed Clean BIM, Item Matrix Rates & Compliance Lints (only once parsed).
	 *    - Step 3: Generate Cost Estimate.
	 * 3. `Model file` — federated IFC file attachment & metadata.
	 */
	import type { Id, Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Field,
		Form,
		Icon,
		Input,
		RunStatus,
		Section,
		Show,
		Spinner,
		Surface,
		Table,
		Tabs,
		enum_text,
		format,
		open_record,
		toast,
		use_act
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		Bound,
		Cluster,
		Column,
		Grid,
		Inline,
		Scroll,
		Split,
		Stack
	} from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { buildTenderBoqCsv } from '../../../services/bim/organizer.js';
	import { recomputeCostEstimateTotals } from '../../../services/bim/pricing.js';
	import type { BimTakeoffLine } from '../../../services/bim/schema.js';
	import { formatCarbon, toNumber } from '../../../services/commercial/decimal.js';
	import { downloadTextFile, safeFilename } from '../../../services/ui/download.js';
	import { storeProjectTakeoff, takeoffProgressText } from '../../../services/viewer/takeoff.js';
	import type {
		IFCSelectedElement,
		IFCViewerFocus,
		IFCViewerMarkerGroup,
		IFCViewerTask
	} from '../../../services/viewer/types.js';
	import BimTakeoffRenderer from '../../custom_field/bim_takeoff/+renderer.svelte';
	import BimPrepareStep from './BimPrepareStep.svelte';

	type ProcessStep = 'parse' | 'review' | 'generate';

	let {
		ctx,
		record,
		mode,
		focus = null,
		onFocusChange,
		onCreateTask
	}: {
		ctx: PageContext;
		record: Row<'projects'>;
		mode: 'view' | 'edit';
		focus: (IFCViewerFocus & { readonly task?: string }) | null;
		onFocusChange: (next: (IFCViewerFocus & { readonly task?: string }) | null) => void;
		onCreateTask: (values: Record<string, unknown>) => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const money = { kind: 'money', currency: 'currency' } as const;
	const canAnalyzeBim = $derived(ctx.catalog?.cost_estimates?.update !== undefined);
	const canUpdateProject = $derived(ctx.catalog?.projects?.update !== undefined);

	const estimateQuery = $derived(
		ctx.query({
			cost_estimates: {
				where: { project_id: { eq: record.id } },
				fields: [
					'revision',
					'estimate_number',
					'title',
					'status',
					'currency',
					'bim_asset_count',
					'classified_asset_count',
					'unmatched_asset_count',
					'bim_assets',
					'bim_subtotal',
					'contingency_pct',
					'contingency_amount',
					'total_estimate',
					'carbon_total',
					'asset_signatures',
					'analyzed_at'
				],
				limit: 1
			}
		})
	);

	const bimTasksQuery = $derived(
		ctx.query({
			tasks: {
				where: { project_id: { eq: record.id }, kind: { eq: 'bim' } },
				fields: ['task_code', 'title', 'status', 'bim_express_ids'],
				order_by: { task_code: 'asc' },
				limit: 500
			}
		})
	);

	const bimSettingsQuery = $derived(
		ctx.query({ bim_settings: { fields: ['code', 'exclude_ifc_classes'], limit: 10 } })
	);

	const viewerExcludeClasses = $derived.by(() => {
		const rows = bimSettingsQuery.current?.bim_settings.rows ?? [];
		return (rows.find((r) => r.code === 'default') ?? rows[0])?.exclude_ifc_classes ?? undefined;
	});
	const projectBimFile = $derived(record.bim_file ?? null);
	const activeIfcSrc = $derived(projectBimFile ? ctx.file_url(projectBimFile) : '');
	const viewer = $derived(
		projectBimFile ? import('../../../services/viewer/IfcViewer.svelte') : null
	);
	const singleEstimate = $derived(estimateQuery.current?.cost_estimates.rows[0] ?? null);
	const activeEstimate = $derived(
		singleEstimate && singleEstimate.status !== 'void' ? singleEstimate : null
	);
	const activeBimAssets = $derived(activeEstimate?.bim_assets ?? []);
	const projectSignatures = $derived<readonly string[]>(
		record.bim_summary?.asset_signatures?.length
			? record.bim_summary.asset_signatures
			: (singleEstimate?.asset_signatures ?? [])
	);

	const bimTasks = $derived<IFCViewerTask[]>(
		(bimTasksQuery.current?.tasks.rows ?? []).flatMap((task) =>
			(task.bim_express_ids?.length ?? 0) > 0
				? [
						{
							id: task.id,
							label: `${task.task_code} · ${task.title}`,
							expressIds: task.bim_express_ids ?? []
						}
					]
				: []
		)
	);
	const bimTaskById = $derived(new Map(bimTasks.map((task) => [task.id, task] as const)));
	const blockedBimIds = $derived(
		(bimTasksQuery.current?.tasks.rows ?? []).flatMap((task) =>
			task.status === 'blocked' && task.bim_express_ids?.length ? [...task.bim_express_ids] : []
		)
	);
	const markerGroups = $derived<IFCViewerMarkerGroup[]>(
		blockedBimIds.length > 0
			? [
					{
						label: t('timeline.filter_blocked'),
						color: 'var(--color-tone-warning-text)',
						expressIds: blockedBimIds
					}
				]
			: []
	);

	let bimActiveTab = $state('model');
	let tunnelOpen = $state(false);
	let stepOverride = $state<ProcessStep | null>(null);
	let step2Edited = $state(false);
	let activeRun = $state<{ readonly id: string } | null>(null);
	let runningPhase = $state<'prepare' | 'cost' | null>(null);
	let prepareRunBaselineAt = $state<string | null | undefined>(undefined);
	let costRunBaselineAt = $state<string | null | undefined>(undefined);
	let startingRun = $state(false);

	const figuresSaver = use_act(ctx);
	let bimStreaming = $state(false);
	let bimUploading = $state(false);
	let bimStreamNotice = $state<string | null>(null);
	let bimStreamError = $state<string | null>(null);
	let bimUploadInput = $state<HTMLInputElement | null>(null);

	let editedLines = $state<readonly BimTakeoffLine[] | null>(null);
	let editedContingency = $state<string | null>(null);
	let editedRevision = $state<number | null>(null);

	// Durable step signals derived from persisted DB columns + live in-tab streaming/runs
	const costingLocked = $derived(
		singleEstimate != null && singleEstimate.status !== 'draft' && singleEstimate.status !== 'void'
	);
	const step1Error = $derived(bimStreamError ?? record.bim_costing_error ?? null);
	const step1Running = $derived(
		bimStreaming ||
			(record.bim_takeoff != null && record.bim_costing_dirty && !record.bim_costing_error) ||
			(runningPhase === 'prepare' &&
				!step1Error &&
				(startingRun ||
					(prepareRunBaselineAt !== undefined &&
						(record.bim_summary?.analyzed_at ?? null) === prepareRunBaselineAt)))
	);
	const step1Ready = $derived(
		record.bim_takeoff != null &&
			record.bim_summary != null &&
			!record.bim_costing_dirty &&
			!bimStreaming &&
			!step1Error
	);
	const step3Running = $derived(
		runningPhase === 'cost' &&
			(startingRun ||
				(costRunBaselineAt !== undefined &&
					(activeEstimate?.analyzed_at ?? null) === costRunBaselineAt))
	);
	const costingStale = $derived(
		activeEstimate != null && (step2Edited || record.bim_summary?.stage === 'prepared')
	);
	const step3Done = $derived(
		activeEstimate !== null &&
			record.bim_summary?.stage === 'costed' &&
			!costingStale &&
			!step3Running
	);
	const costingBusy = $derived(step1Running || step3Running || startingRun);

	const durableStep = $derived<ProcessStep>(
		step1Running || !step1Ready
			? 'parse'
			: step3Running
				? 'generate'
				: !activeEstimate || costingStale
					? 'review'
					: 'generate'
	);
	const activeStep = $derived<ProcessStep>(!step1Ready ? 'parse' : (stepOverride ?? durableStep));

	// Pending Item Matrix proposal count for Step 3 readiness callout
	const readinessMappingsQuery = $derived(
		tunnelOpen && step1Ready && projectSignatures.length > 0
			? ctx.query({
					asset_mappings: {
						where: { signature: { in: [...projectSignatures] } },
						fields: ['review_status'],
						limit: Math.max(projectSignatures.length, 250)
					}
				})
			: null
	);
	const readinessMappings = $derived(readinessMappingsQuery?.current?.asset_mappings.rows ?? []);
	const readinessPendingProposals = $derived(
		readinessMappings.filter((r) => r.$approval != null).length
	);
	const readinessVerified = $derived(
		readinessMappings.filter((r) => r.review_status === 'verified').length
	);

	const step1LiveDetail = $derived.by(() => {
		if (bimStreaming && bimStreamNotice) return bimStreamNotice;
		if (record.bim_takeoff != null && record.bim_costing_dirty)
			return bimStreamNotice ?? t('bim_workflow.step1_analyzing_detail');
		return t('bim_workflow.step1_analyzing_detail');
	});

	function openTunnel(step?: ProcessStep) {
		stepOverride = step ?? durableStep;
		tunnelOpen = true;
	}

	function focusTask(taskId: string) {
		const task = bimTaskById.get(taskId);
		if (task === undefined) return open_record('tasks', taskId);
		onFocusChange(
			focus?.task === taskId
				? null
				: { task: taskId, label: task.label, expressIds: [...task.expressIds] }
		);
	}

	function startBimRun(phase: 'prepare' | 'cost') {
		if (startingRun || bimStreaming) return;
		startingRun = true;
		runningPhase = phase;
		if (phase === 'prepare') prepareRunBaselineAt = record.bim_summary?.analyzed_at ?? null;
		if (phase === 'cost') costRunBaselineAt = activeEstimate?.analyzed_at ?? null;
		fork(
			ctx.run('analyze_bim_file', { project_id: record.id, phase }).pipe(
				Effect.match({
					onFailure: (error) => {
						startingRun = false;
						runningPhase = null;
						prepareRunBaselineAt = undefined;
						costRunBaselineAt = undefined;
						toast.error('message' in error ? error.message : String(error));
					},
					onSuccess: (res) => {
						startingRun = false;
						if (res.kind === 'committed') {
							activeRun = { id: res.output.id };
						} else {
							runningPhase = null;
							prepareRunBaselineAt = undefined;
							costRunBaselineAt = undefined;
						}
					}
				})
			)
		);
	}

	const takeOff = (projectId: Id<'projects'>, source: File | string) => {
		bimStreamError = null;
		bimStreamNotice = null;
		bimStreaming = true;
		runningPhase = 'prepare';
		stepOverride = 'parse';
		return storeProjectTakeoff(ctx, projectId, source, (progress) => {
			bimStreamNotice = takeoffProgressText(t, progress);
		}).pipe(
			Effect.match({
				onFailure: (error) => {
					bimStreaming = false;
					runningPhase = null;
					bimStreamNotice = null;
					bimStreamError = 'message' in error ? error.message : String(error);
				},
				onSuccess: (res) => {
					bimStreaming = false;
					bimStreamNotice = t('bim_costing.streaming_done', {
						assets: res.extracted.total_asset_count,
						archetypes: res.extracted.archetypes.length,
						visuals: res.visualCapturedCount,
						duplicates: res.duplicates,
						ms: res.durationMs
					});
				}
			})
		);
	};

	function handleUploadProjectBim(event: Event) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;
		const file = target.files?.[0];
		target.value = '';
		if (!file || bimUploading || bimStreaming) return;
		bimStreamError = null;
		bimUploading = true;
		const projectId = record.id;
		const revision = record.revision;
		fork(
			ctx.upload(file, 'projects.bim_file').pipe(
				Effect.flatMap((fileRef) =>
					ctx.act({
						'projects.update': [{ target: { id: projectId, revision }, set: { bim_file: fileRef } }]
					})
				),
				Effect.match({
					onFailure: (error) => {
						bimUploading = false;
						bimStreamError = 'message' in error ? error.message : String(error);
						return false;
					},
					onSuccess: () => {
						bimUploading = false;
						return true;
					}
				}),
				Effect.flatMap((stored) => (stored ? takeOff(projectId, file) : Effect.void))
			)
		);
	}

	function runStep1Parse() {
		if (!projectBimFile || bimStreaming || startingRun) return;
		bimStreamError = null;
		stepOverride = 'parse';
		if (record.bim_takeoff == null) {
			fork(takeOff(record.id, ctx.file_url(projectBimFile)));
			return;
		}
		startBimRun('prepare');
	}

	function reParseProjectBim() {
		if (!projectBimFile || bimStreaming || startingRun) return;
		bimStreamError = null;
		stepOverride = 'parse';
		fork(takeOff(record.id, ctx.file_url(projectBimFile)));
	}

	function runStep3Generate() {
		if (
			!projectBimFile ||
			record.bim_takeoff == null ||
			bimStreaming ||
			startingRun ||
			costingLocked
		)
			return;
		step2Edited = false;
		stepOverride = 'generate';
		startBimRun('cost');
	}

	const liveLines = $derived(
		singleEstimate && editedRevision === singleEstimate.revision && editedLines !== null
			? editedLines
			: (singleEstimate?.bim_assets ?? [])
	);
	const liveContingency = $derived(
		singleEstimate && editedRevision === singleEstimate.revision && editedContingency !== null
			? editedContingency
			: String(singleEstimate?.contingency_pct ?? '5')
	);
	const figuresDirty = $derived(
		singleEstimate !== null &&
			editedRevision === singleEstimate.revision &&
			(editedLines !== null || editedContingency !== null)
	);
	const liveTotals = $derived(
		figuresDirty
			? recomputeCostEstimateTotals({ bim_assets: liveLines, contingency_pct: liveContingency })
			: null
	);

	function updateDraftLines(next: readonly BimTakeoffLine[]) {
		if (!singleEstimate || costingLocked) return;
		editedRevision = singleEstimate.revision;
		editedLines = next;
	}
	function updateDraftContingency(next: string) {
		if (!singleEstimate || costingLocked) return;
		editedRevision = singleEstimate.revision;
		editedContingency = next;
	}
	function saveEditedFigures() {
		if (!singleEstimate || !figuresDirty || figuresSaver.pending) return;
		figuresSaver.run(
			ctx
				.act({
					'cost_estimates.update': [
						{
							target: { id: singleEstimate.id, revision: singleEstimate.revision },
							set: { bim_assets: [...liveLines], contingency_pct: liveContingency }
						}
					]
				})
				.pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							editedLines = null;
							editedContingency = null;
							editedRevision = null;
						})
					)
				)
		);
	}
	function toggleBaselineEstimate() {
		if (!singleEstimate || figuresDirty || figuresSaver.pending || costingBusy) return;
		figuresSaver.run(
			ctx.act({
				'cost_estimates.update': [
					{
						target: { id: singleEstimate.id, revision: singleEstimate.revision },
						set: { status: singleEstimate.status === 'baselined' ? 'draft' : 'baselined' }
					}
				]
			})
		);
	}
	function exportBoqCsv() {
		if (!singleEstimate) return;
		const csv = buildTenderBoqCsv({
			projectName: record.project_name,
			currency: singleEstimate.currency,
			bimAssets: liveLines,
			bimSubtotal: liveTotals?.bim_subtotal ?? singleEstimate.bim_subtotal,
			contingencyPct: liveContingency,
			contingencyAmount: liveTotals?.contingency_amount ?? singleEstimate.contingency_amount,
			totalEstimate: liveTotals?.total_estimate ?? singleEstimate.total_estimate
		});
		downloadTextFile(
			csv,
			`${safeFilename(record.project_name)}_Tender_BOQ.csv`,
			'text/csv;charset=utf-8'
		);
	}
	function createTaskFromBim(element: IFCSelectedElement) {
		onCreateTask({
			project_id: record.id,
			kind: 'bim',
			title: element.subtitle ? `${element.subtitle} · ${element.title}` : element.title,
			bim_express_ids: [element.expressId]
		});
	}
	function inspect3d(expressIds: readonly number[], label: string) {
		onFocusChange({ label, expressIds: [...expressIds] });
		bimActiveTab = 'model';
	}
</script>

{#if canUpdateProject}
	<input
		bind:this={bimUploadInput}
		type="file"
		accept=".ifc,application/octet-stream"
		class="hidden"
		onchange={handleUploadProjectBim}
	/>
{/if}

{#snippet taskTitleCell({
	row
}: {
	row: {
		readonly title: string;
		readonly is_milestone?: boolean | null;
		readonly wbs_path?: string | null;
	};
})}
	<div class="flex min-w-0 items-center gap-1.5">
		{#if row.is_milestone}
			<Icon name="lucide:diamond" class="size-3 shrink-0 text-tone-warning-text" />
		{/if}
		<span class="min-w-0 flex-1 truncate text-foreground" title={row.title}>{row.title}</span>
		{#if row.wbs_path}
			<span class="shrink-0 font-mono text-tiny text-muted-foreground">{row.wbs_path}</span>
		{/if}
	</div>
{/snippet}

{#snippet taskProgressCell({
	row
}: {
	row: {
		readonly progress_pct: string;
		readonly status: string;
		readonly is_milestone?: boolean | null;
	};
})}
	{@const pct = Math.round(toNumber(row.progress_pct))}
	<div class="flex items-center justify-end gap-1.5 tabular-nums">
		{#if !row.is_milestone}
			<div class="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full {row.status === 'done'
						? 'bg-tone-success-text'
						: row.status === 'blocked'
							? 'bg-tone-destructive-text'
							: 'bg-primary'}"
					style={`width: ${pct}%`}
				></div>
			</div>
		{/if}
		<span class="w-7 text-right text-micro">{pct}%</span>
	</div>
{/snippet}

{#snippet bimViewerPane()}
	<Stack gap="xs" size="fill">
		{#if projectBimFile && viewer && activeIfcSrc}
			{#await viewer}
				<Inline align="center" justify="center" size="fill" aria-busy="true">
					<Spinner />
					<span class="text-xs text-muted-foreground">{t('component.loading_viewer')}</span>
				</Inline>
			{:then mod}
				<mod.default
					t={ctx.t}
					src={activeIfcSrc}
					alt={projectBimFile.name}
					{markerGroups}
					tasks={bimTasks}
					{focus}
					onClearFocus={() => onFocusChange(null)}
					{...ctx.catalog?.tasks?.create !== undefined ? { onCreateTask: createTaskFromBim } : {}}
					onOpenTask={(taskId) => open_record('tasks', taskId)}
					{...canUpdateProject ? { onReplaceModel: () => bimUploadInput?.click() } : {}}
					{...viewerExcludeClasses ? { excludeClasses: viewerExcludeClasses } : {}}
				/>
			{:catch error}
				<Alert.Root variant="destructive"><Alert.Title>{String(error)}</Alert.Title></Alert.Root>
			{/await}
		{:else}
			<EmptyState
				variant="card"
				icon="file"
				title={t('component.no_ifc_model')}
				hint={t('component.link_ifc_document')}
			>
				{#if canUpdateProject}
					<Button variant="outline" disabled={bimUploading} onclick={() => bimUploadInput?.click()}>
						<Icon name="lucide:upload" class="size-3.5" />
						{t('component.upload_ifc_model')}
					</Button>
				{/if}
			</EmptyState>
		{/if}
	</Stack>
{/snippet}

{#snippet bimTasksTable()}
	<Table
		{ctx}
		of="tasks"
		key={`project:bim-tasks:${record.id}`}
		where={{ project_id: { eq: record.id }, kind: { eq: 'bim' } }}
		order_by={{ task_code: 'asc' }}
		on_open={(row) => focusTask(row.id)}
		row_class={(row) => (row.id === focus?.task ? 'bg-accent/40 [&>td]:bg-accent' : undefined)}
		actions={[{ label: t('bim.open_task'), run: (row) => open_record('tasks', row.id) }]}
		toolbar={{ title: t('bim.tasks_title'), description: t('bim.tasks_hint'), new: false }}
		columns={[
			{ field: 'task_code', width: 88 },
			{ field: 'title', width: 220, cell: taskTitleCell },
			{ field: 'status', width: 96 },
			{ field: 'progress_pct', width: 84, align: 'end', cell: taskProgressCell },
			{ field: 'schedule_range', width: 148, hide: 'narrow' }
		]}
	/>
{/snippet}

{#snippet bimTasksTab()}
	<Bound size="fill" inset>
		<Split
			size="fill"
			ratio="wide"
			collapse="switch"
			switch_labels={[t('component.coordination_model'), t('bim.tasks_title')]}
			start={bimViewerPane}
			end={bimTasksTable}
		/>
	</Bound>
{/snippet}

{#snippet costingTunnelView()}
	<Stack gap="md">
		<!-- Tunneled process navigation bar: Back button + 3 phased steps -->
		<Surface tone="subtle" padding="xs" radius="control">
			<Cluster align="center" justify="between" gap="sm">
				<Button variant="ghost" onclick={() => (tunnelOpen = false)}>
					<Icon name="lucide:arrow-left" class="size-3.5" />
					{t('bim_workflow.back')}
				</Button>
				<Cluster align="center" gap="xs">
					<Button
						variant={activeStep === 'parse' ? 'secondary' : 'ghost'}
						aria-current={activeStep === 'parse' ? 'step' : undefined}
						onclick={() => (stepOverride = 'parse')}
					>
						{#if step1Running}
							<Spinner class="size-3.5" />
						{:else}
							<Icon
								name={step1Ready ? 'lucide:circle-check' : 'lucide:circle-dot'}
								class={step1Ready ? 'size-3.5 text-tone-success-text' : 'size-3.5 text-primary'}
							/>
						{/if}
						{t('bim_workflow.step1_pill')}
					</Button>
					<Icon name="lucide:chevron-right" class="size-3.5 text-muted-foreground" />
					<Button
						variant={activeStep === 'review' ? 'secondary' : 'ghost'}
						aria-current={activeStep === 'review' ? 'step' : undefined}
						disabled={!step1Ready}
						disabled_message={t('bim_workflow.step_locked_hint')}
						onclick={() => (stepOverride = 'review')}
					>
						<Icon
							name={step3Done
								? 'lucide:circle-check'
								: activeStep === 'review'
									? 'lucide:circle-dot'
									: 'lucide:circle'}
							class={step3Done
								? 'size-3.5 text-tone-success-text'
								: activeStep === 'review'
									? 'size-3.5 text-primary'
									: 'size-3.5 text-muted-foreground'}
						/>
						{t('bim_workflow.step2_pill')}
					</Button>
					<Icon name="lucide:chevron-right" class="size-3.5 text-muted-foreground" />
					<Button
						variant={activeStep === 'generate' ? 'secondary' : 'ghost'}
						aria-current={activeStep === 'generate' ? 'step' : undefined}
						disabled={!step1Ready}
						disabled_message={t('bim_workflow.step_locked_hint')}
						onclick={() => (stepOverride = 'generate')}
					>
						{#if step3Running}
							<Spinner class="size-3.5" />
						{:else}
							<Icon
								name={step3Done
									? 'lucide:circle-check'
									: activeStep === 'generate'
										? 'lucide:circle-dot'
										: 'lucide:circle'}
								class={step3Done
									? 'size-3.5 text-tone-success-text'
									: activeStep === 'generate'
										? 'size-3.5 text-primary'
										: 'size-3.5 text-muted-foreground'}
							/>
						{/if}
						{t('bim_workflow.step3_pill')}
					</Button>
				</Cluster>
			</Cluster>
		</Surface>

		{#if activeStep === 'parse'}
			<!-- Step 1: Parse & Analyze only (zero review tables or premature Step 2/3 buttons) -->
			<Surface tone="card" padding="md" radius="control">
				<Stack gap="md">
					<Cluster align="center" justify="between" gap="sm">
						<Stack gap="xs">
							<span class="text-label">{t('bim_workflow.step1_heading')}</span>
							<span class="text-meta">{t('bim_workflow.step1_desc')}</span>
						</Stack>
						{#if projectBimFile}
							<Badge variant="outline" class="font-mono text-tiny">
								<Icon name="lucide:file-box" class="size-3" />
								{projectBimFile.name}
							</Badge>
						{/if}
					</Cluster>

					{#if !projectBimFile}
						<EmptyState
							variant="card"
							icon="file"
							title={t('component.no_ifc_model')}
							hint={t('bim_workflow.empty_no_model_hint')}
						>
							{#if canUpdateProject}
								<Button
									variant="brand"
									disabled={bimUploading}
									onclick={() => bimUploadInput?.click()}
								>
									<Icon name="lucide:upload" class="size-3.5" />
									{t('component.upload_ifc_model')}
								</Button>
							{/if}
						</EmptyState>
					{:else if step1Running}
						<Surface tone="subtle" padding="md" radius="control">
							<Stack gap="sm">
								<Inline gap="sm" align="center" aria-live="polite">
									<Spinner class="size-4 shrink-0" />
									<span class="text-label">{t('bim_workflow.step1_running_title')}</span>
								</Inline>
								<p class="text-xs text-muted-foreground">{step1LiveDetail}</p>
								{#if activeRun && runningPhase === 'prepare'}
									<RunStatus {ctx} automation="analyze_bim_file" run={activeRun} />
								{/if}
								<p class="text-meta">{t('bim_workflow.durable_back_hint')}</p>
							</Stack>
						</Surface>
					{:else if step1Error}
						<Alert.Root variant="destructive">
							<Alert.Title>{t('bim_workflow.step1_failed_title')}</Alert.Title>
							<Alert.Description>{step1Error}</Alert.Description>
						</Alert.Root>
						<Cluster gap="xs">
							{#if canAnalyzeBim}
								<Button variant="brand" disabled={costingBusy} onclick={runStep1Parse}>
									<Icon name="lucide:refresh-cw" class="size-3.5" />
									{t('bim_workflow.retry_step1')}
								</Button>
								{#if record.bim_takeoff != null}
									<Button variant="outline" disabled={costingBusy} onclick={reParseProjectBim}>
										<Icon name="lucide:scan-line" class="size-3.5" />
										{t('bim_step.reparse_ifc')}
									</Button>
								{/if}
							{/if}
						</Cluster>
					{:else if step1Ready && record.bim_summary}
						<Surface tone="subtle" padding="md" radius="control">
							<Stack gap="md">
								<Inline gap="xs" align="center" class="text-xs text-tone-success-text">
									<Icon name="lucide:circle-check" class="size-4 shrink-0" />
									<span>
										{t('bim_workflow.step1_complete', {
											when: format({ kind: 'instant' }, record.bim_summary.analyzed_at, {
												locale: ctx.locale
											})
										})}
									</span>
								</Inline>
								<Grid minimum="card" gap="md">
									<Stack gap="xs">
										<span class="text-meta">{t('bim_workflow.stat_elements')}</span>
										<span class="text-label tabular-nums">{record.bim_summary.asset_count}</span>
									</Stack>
									<Stack gap="xs">
										<span class="text-meta">{t('bim_workflow.stat_unique_assets')}</span>
										<span class="text-label tabular-nums">{projectSignatures.length}</span>
									</Stack>
									<Stack gap="xs">
										<span class="text-meta">{t('bim_workflow.stat_storeys')}</span>
										<span class="text-label tabular-nums">{record.bim_summary.storey_count}</span>
									</Stack>
									{#if record.bim_compliance}
										<Stack gap="xs">
											<span class="text-meta">{t('bim_compliance.score_label')}</span>
											<span class="text-label tabular-nums">
												{`${record.bim_compliance.score_pct}%`}
											</span>
										</Stack>
									{/if}
								</Grid>
								{#if (record.bim_summary.upgraded_classes ?? 0) > 0 || (record.bim_summary.propagated_services ?? 0) > 0 || (record.bim_summary.multi_storey_splits ?? 0) > 0 || (record.bim_summary.dropped_duplicates ?? 0) > 0}
									<Inline gap="xs" align="center" class="text-micro text-tone-info-text">
										<Icon name="lucide:sparkles" class="size-3 shrink-0" />
										<span>
											{t('bim_costing.cleanup_summary', {
												upgraded: record.bim_summary.upgraded_classes ?? 0,
												services: record.bim_summary.propagated_services ?? 0,
												splits: record.bim_summary.multi_storey_splits ?? 0,
												duplicates: record.bim_summary.dropped_duplicates ?? 0
											})}
										</span>
									</Inline>
								{/if}
							</Stack>
						</Surface>
						<Cluster align="center" justify="between" gap="sm">
							<Cluster gap="xs">
								{#if canAnalyzeBim}
									<Button variant="outline" disabled={costingBusy} onclick={runStep1Parse}>
										<Icon name="lucide:refresh-cw" class="size-3.5" />
										{t('bim_workflow.rerun_step1')}
									</Button>
									<Button variant="outline" disabled={costingBusy} onclick={reParseProjectBim}>
										<Icon name="lucide:scan-line" class="size-3.5" />
										{t('bim_step.reparse_ifc')}
									</Button>
								{/if}
							</Cluster>
							<Button variant="brand" onclick={() => (stepOverride = 'review')}>
								<Icon name="lucide:arrow-right" class="size-3.5" />
								{t('bim_workflow.continue_step2')}
							</Button>
						</Cluster>
					{:else}
						<Cluster gap="xs">
							{#if canAnalyzeBim}
								<Button variant="brand" disabled={costingBusy} onclick={runStep1Parse}>
									<Icon name="lucide:play" class="size-3.5" />
									{t('bim_workflow.start_step1')}
								</Button>
							{/if}
						</Cluster>
					{/if}
				</Stack>
			</Surface>
		{:else if activeStep === 'review'}
			<!-- Step 2: Review Proposed Item Matrix, Clean BIM & Compliance Lints -->
			<BimPrepareStep
				{ctx}
				projectName={record.project_name}
				currency={record.currency}
				bimFile={record.bim_file ?? null}
				bimTakeoff={record.bim_takeoff ?? null}
				bimSummary={record.bim_summary ?? null}
				compliance={record.bim_compliance ?? null}
				signatures={projectSignatures}
				bimAssets={activeBimAssets}
				busy={costingBusy}
				canAnalyze={canAnalyzeBim}
				onRerunCompliance={runStep1Parse}
				onContinueToCosting={() => (stepOverride = 'generate')}
				onInspect3d={inspect3d}
				onMutated={() => (step2Edited = true)}
			/>
		{:else}
			<!-- Step 3: Generate Cost Estimate -->
			<Surface tone="card" padding="md" radius="control">
				<Stack gap="md">
					<Stack gap="xs">
						<span class="text-label">{t('bim_workflow.step3_heading')}</span>
						<span class="text-meta">{t('bim_workflow.step3_desc')}</span>
					</Stack>

					{#if step3Running}
						<Surface tone="subtle" padding="md" radius="control">
							<Stack gap="sm">
								<Inline gap="sm" align="center" aria-live="polite">
									<Spinner class="size-4 shrink-0" />
									<span class="text-label">{t('bim_workflow.step3_running_title')}</span>
								</Inline>
								{#if activeRun}
									<RunStatus {ctx} automation="analyze_bim_file" run={activeRun} />
								{/if}
								<p class="text-meta">{t('bim_workflow.durable_back_hint')}</p>
							</Stack>
						</Surface>
					{:else if step3Done && activeEstimate}
						<Surface tone="subtle" padding="md" radius="control">
							<Stack gap="md">
								<Inline gap="xs" align="center" class="text-xs text-tone-success-text">
									<Icon name="lucide:circle-check" class="size-4 shrink-0" />
									<span>{t('bim_workflow.step3_complete')}</span>
								</Inline>
								<Grid minimum="card" gap="md">
									<Stack gap="xs">
										<span class="text-meta">{t('bim_costing.coverage')}</span>
										<span class="text-label tabular-nums">
											{`${activeEstimate.classified_asset_count} / ${activeEstimate.bim_asset_count}`}
										</span>
									</Stack>
									<Stack gap="xs">
										<span class="text-meta">{t('bim_costing.total_estimate')}</span>
										<span class="text-label tabular-nums text-primary">
											<Show
												{ctx}
												kind={money}
												value={activeEstimate.total_estimate}
												row={activeEstimate}
											/>
										</span>
									</Stack>
									<Stack gap="xs">
										<span class="text-meta">{t('bim_costing.carbon_total')}</span>
										<span class="text-label tabular-nums">
											{formatCarbon(activeEstimate.carbon_total)}
										</span>
									</Stack>
								</Grid>
							</Stack>
						</Surface>
						<Cluster align="center" justify="between" gap="sm">
							{#if canAnalyzeBim && !costingLocked}
								<Button variant="outline" disabled={costingBusy} onclick={runStep3Generate}>
									<Icon name="lucide:refresh-cw" class="size-3.5" />
									{t('bim_step.regenerate_phase2')}
								</Button>
							{:else}
								<span></span>
							{/if}
							<Button variant="brand" onclick={() => (tunnelOpen = false)}>
								<Icon name="lucide:check" class="size-3.5" />
								{t('bim_workflow.view_estimate')}
							</Button>
						</Cluster>
					{:else}
						<Surface tone="subtle" padding="md" radius="control">
							<Grid minimum="card" gap="md">
								<Stack gap="xs">
									<span class="text-meta">{t('bim_workflow.stat_unique_assets')}</span>
									<span class="text-label tabular-nums">{projectSignatures.length}</span>
								</Stack>
								{#if readinessMappings.length > 0}
									<Stack gap="xs">
										<span class="text-meta">{t('bim_review.verified')}</span>
										<span class="text-label tabular-nums">
											{`${readinessVerified} / ${readinessMappings.length}`}
										</span>
									</Stack>
								{/if}
								{#if record.bim_compliance}
									<Stack gap="xs">
										<span class="text-meta">{t('bim_compliance.score_label')}</span>
										<span class="text-label tabular-nums">
											{`${record.bim_compliance.score_pct}%`}
										</span>
									</Stack>
								{/if}
							</Grid>
						</Surface>

						{#if readinessPendingProposals > 0}
							<Alert.Root variant="warning">
								<Alert.Title>
									{t('bim_workflow.pending_proposals_warning', {
										count: readinessPendingProposals
									})}
								</Alert.Title>
							</Alert.Root>
						{/if}

						{#if costingLocked}
							<Alert.Root variant="secondary">
								<Alert.Title>{t('bim_costing.locked_hint')}</Alert.Title>
							</Alert.Root>
						{/if}

						{#if activeRun && runningPhase === 'cost'}
							<RunStatus {ctx} automation="analyze_bim_file" run={activeRun} />
						{/if}

						<Cluster align="center" justify="between" gap="sm">
							<Button variant="outline" onclick={() => (stepOverride = 'review')}>
								<Icon name="lucide:arrow-left" class="size-3.5" />
								{t('bim_workflow.back_to_step2')}
							</Button>
							{#if canAnalyzeBim && projectBimFile}
								<Button
									variant="brand"
									disabled={costingBusy || costingLocked}
									onclick={runStep3Generate}
								>
									<Icon name="lucide:calculator" class="size-3.5" />
									{activeEstimate ? t('bim_step.regenerate_phase2') : t('bim_step.generate_phase2')}
								</Button>
							{/if}
						</Cluster>
					{/if}
				</Stack>
			</Surface>
		{/if}
	</Stack>
{/snippet}

{#snippet emptyCostingFallback()}
	{#if !projectBimFile}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_title')}
			hint={t('bim_workflow.empty_no_model_hint')}
		>
			{#if canUpdateProject}
				<Button variant="brand" disabled={bimUploading} onclick={() => bimUploadInput?.click()}>
					<Icon name="lucide:upload" class="size-3.5" />
					{t('component.upload_ifc_model')}
				</Button>
			{/if}
		</EmptyState>
	{:else if step1Running}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_in_progress_title')}
			hint={t('bim_workflow.empty_step1_running_hint', { detail: step1LiveDetail })}
		>
			<Stack gap="sm" align="center">
				<Badge variant="outline">
					<Spinner class="size-3" />
					{t('bim_workflow.badge_step_progress', {
						step: 1,
						total: 3,
						label: t('bim_workflow.step1_short')
					})}
				</Badge>
				<Button variant="brand" onclick={() => openTunnel('parse')}>
					<Icon name="lucide:arrow-right" class="size-3.5" />
					{t('bim_workflow.view_progress')}
				</Button>
			</Stack>
		</EmptyState>
	{:else if step3Running}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_in_progress_title')}
			hint={t('bim_workflow.empty_step3_running_hint')}
		>
			<Stack gap="sm" align="center">
				<Badge variant="outline">
					<Spinner class="size-3" />
					{t('bim_workflow.badge_step_progress', {
						step: 3,
						total: 3,
						label: t('bim_workflow.step3_short')
					})}
				</Badge>
				<Button variant="brand" onclick={() => openTunnel('generate')}>
					<Icon name="lucide:arrow-right" class="size-3.5" />
					{t('bim_workflow.view_progress')}
				</Button>
			</Stack>
		</EmptyState>
	{:else if step1Error}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_paused_title')}
			hint={t('bim_workflow.empty_paused_hint', { reason: step1Error })}
		>
			<Stack gap="sm" align="center">
				<Badge variant="destructive">
					{t('bim_workflow.badge_step_progress', {
						step: 1,
						total: 3,
						label: t('bim_workflow.step1_short')
					})}
				</Badge>
				<Button variant="brand" onclick={() => openTunnel('parse')}>
					<Icon name="lucide:refresh-cw" class="size-3.5" />
					{t('bim_workflow.resume_process')}
				</Button>
			</Stack>
		</EmptyState>
	{:else if step1Ready && record.bim_summary}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_ready_review_title')}
			hint={t('bim_workflow.empty_ready_review_hint', {
				elements: record.bim_summary.asset_count,
				unique: projectSignatures.length,
				score: record.bim_compliance?.score_pct ?? 100
			})}
		>
			<Stack gap="sm" align="center">
				<Badge variant="outline">
					<Icon name="lucide:circle-dot" class="size-3 text-primary" />
					{t('bim_workflow.badge_step_progress', {
						step: 2,
						total: 3,
						label: t('bim_workflow.step2_short')
					})}
				</Badge>
				<Button variant="brand" onclick={() => openTunnel('review')}>
					<Icon name="lucide:arrow-right" class="size-3.5" />
					{t('bim_workflow.continue_process')}
				</Button>
			</Stack>
		</EmptyState>
	{:else}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_workflow.empty_title')}
			hint={t('bim_workflow.empty_start_hint')}
		>
			{#if canAnalyzeBim}
				<Button variant="brand" onclick={() => openTunnel('parse')}>
					<Icon name="lucide:play" class="size-3.5" />
					{t('bim_workflow.start_process')}
				</Button>
			{/if}
		</EmptyState>
	{/if}
{/snippet}

{#snippet bimCostingTab()}
	<Scroll name={t('bim_costing.estimates_title')} size="fill" inset>
		<Stack gap="md">
			{#if tunnelOpen}
				{@render costingTunnelView()}
			{:else if estimateQuery.loading && !estimateQuery.current}
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
				</Inline>
			{:else if estimateQuery.error}
				<Alert.Root variant="destructive">
					<Alert.Title>{estimateQuery.error.message}</Alert.Title>
				</Alert.Root>
			{:else if activeEstimate}
				{@const est = activeEstimate}
				<Surface tone="card" padding="md" radius="control">
					<Stack gap="md" divided>
						<Stack gap="xs">
							<Cluster align="center" justify="between" gap="sm">
								<Inline gap="sm" align="center">
									<span class="text-label">{est.title}</span>
									<Badge variant="outline">
										{enum_text(est.status, { t: rawT, model: 'cost_estimates', field: 'status' })}
									</Badge>
									{#if record.bim_compliance}
										<Button variant="ghost" onclick={() => openTunnel('review')}>
											<Badge
												variant={record.bim_compliance.fail_count > 0
													? 'destructive'
													: record.bim_compliance.warn_count > 0
														? 'warning'
														: 'success'}
											>
												{t('bim_costing.compliance_pill', { pct: record.bim_compliance.score_pct })}
											</Badge>
										</Button>
									{/if}
								</Inline>
								<Cluster gap="xs">
									{#if canAnalyzeBim && projectBimFile}
										<Button
											variant={!figuresDirty && (costingStale || step1Running || step3Running)
												? 'brand'
												: 'outline'}
											onclick={() => openTunnel()}
										>
											{#if step1Running || step3Running}
												<Spinner class="size-3.5" />
											{:else}
												<Icon name="lucide:workflow" class="size-3.5" />
											{/if}
											{step1Running || step3Running
												? t('bim_workflow.view_progress')
												: t('bim_workflow.open_process')}
										</Button>
									{/if}
									{#if canAnalyzeBim}
										<Button
											variant={figuresDirty ? 'brand' : 'outline'}
											disabled={!figuresDirty || figuresSaver.pending || costingLocked}
											onclick={saveEditedFigures}
										>
											<Icon name="lucide:check" class="size-3.5" />
											{t('bim_costing.save_figures')}
										</Button>
										<Button
											variant="outline"
											disabled={figuresDirty || figuresSaver.pending || costingBusy}
											onclick={toggleBaselineEstimate}
										>
											<Icon
												name={est.status === 'baselined' ? 'lucide:lock-open' : 'lucide:lock'}
												class="size-3.5"
											/>
											{est.status === 'baselined'
												? t('bim_costing.reopen_draft')
												: t('bim_costing.baseline_estimate')}
										</Button>
									{/if}
									<Button variant="outline" onclick={exportBoqCsv}>
										<Icon name="lucide:download" class="size-3.5" />
										{t('bim_costing.export_boq_csv')}
									</Button>
								</Cluster>
							</Cluster>
							{#if costingStale}
								<p
									class="flex min-w-0 items-center gap-1.5 text-xs text-warning"
									aria-live="polite"
								>
									<Icon name="lucide:triangle-alert" class="size-3.5 shrink-0" />
									<span class="truncate">{t('bim_step.phase1_updated_hint')}</span>
								</p>
							{:else if est.analyzed_at}
								<p class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
									<Icon
										name="lucide:circle-check"
										class="size-3.5 shrink-0 text-tone-success-text"
									/>
									<span class="truncate">
										{t('bim_costing.status_priced', {
											when: format({ kind: 'instant' }, est.analyzed_at, { locale: ctx.locale })
										})}
									</span>
								</p>
							{/if}
						</Stack>
						<Grid minimum="card" gap="md">
							<Stack gap="xs">
								<span class="text-meta">{t('bim_costing.coverage')}</span>
								<Inline gap="xs" align="center">
									<span class="text-label tabular-nums"
										>{`${est.classified_asset_count} / ${est.bim_asset_count}`}</span
									>
									{#if est.unmatched_asset_count > 0}
										<Badge variant="warning"
											>{t('bim_costing.unmatched_badge', {
												count: est.unmatched_asset_count
											})}</Badge
										>
									{/if}
								</Inline>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('bim_costing.bim_subtotal')}</span>
								<span class="text-label tabular-nums">
									<Show
										{ctx}
										kind={money}
										value={liveTotals?.bim_subtotal ?? est.bim_subtotal}
										row={est}
									/>
								</span>
							</Stack>
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<span class="text-meta">{t('bim_costing.contingency')}</span>
									<Input
										value={liveContingency}
										type="number"
										disabled={!canAnalyzeBim || costingLocked || figuresSaver.pending}
										aria-label={t('bim_costing.contingency')}
										class="text-right font-mono text-xs"
										oninput={(e) => updateDraftContingency(e.currentTarget.value)}
									/>
									<span class="text-meta">{'%'}</span>
								</Inline>
								<span class="text-label tabular-nums">
									<Show
										{ctx}
										kind={money}
										value={liveTotals?.contingency_amount ?? est.contingency_amount}
										row={est}
									/>
								</span>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('bim_costing.total_estimate')}</span>
								<span class="text-sm tabular-nums text-primary">
									<Show
										{ctx}
										kind={money}
										value={liveTotals?.total_estimate ?? est.total_estimate}
										row={est}
									/>
								</span>
							</Stack>
						</Grid>
					</Stack>
				</Surface>

				<Surface tone="card" padding="md" radius="control">
					{#if canAnalyzeBim}
						<BimTakeoffRenderer
							{ctx}
							view={{
								mode: 'edit',
								name: 'bim_takeoff',
								value: liveLines,
								disabled: costingLocked || figuresSaver.pending,
								on_change: (next) => updateDraftLines(next ?? [])
							}}
						/>
					{:else}
						<BimTakeoffRenderer
							{ctx}
							view={{ mode: 'show', name: 'bim_takeoff', value: liveLines }}
						/>
					{/if}
				</Surface>
			{:else}
				{@render emptyCostingFallback()}
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet bimFileTab()}
	<Form {ctx} of="projects" {mode} id={record.id} {record}>
		<Section icon="lucide:file-box" first name="bim_model" title={t('section.bim_model')}>
			<Grid minimum="compact">
				<Field {ctx} name="bim_version" />
				<Column span="all"><Field {ctx} name="bim_file" /></Column>
				{#if record.bim_summary != null}
					<Column span="all"><Field {ctx} name="bim_summary" readonly /></Column>
				{/if}
			</Grid>
		</Section>
	</Form>
{/snippet}

<Tabs
	level={2}
	bind:value={bimActiveTab}
	tabs={[
		{
			name: 'model',
			title: t('bim.tab_model_tasks'),
			icon: 'lucide:box',
			keep_alive: true,
			body: bimTasksTab
		},
		{
			name: 'costing',
			title: t('bim_costing.estimates_title'),
			icon: 'lucide:calculator',
			keep_alive: true,
			body: bimCostingTab
		},
		{
			name: 'model_file',
			title: t('bim.tab_model_file'),
			icon: 'lucide:file-box',
			keep_alive: true,
			body: bimFileTab
		}
	]}
/>
