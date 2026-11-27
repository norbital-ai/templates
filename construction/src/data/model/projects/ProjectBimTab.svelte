<script lang="ts">
	/**
	 * Project Hub → BIM tab:
	 * 1. `3D Model & Tasks` — live 3D IFC viewer + linked BIM tasks.
	 * 2. `BIM Costing` — repeatable 2-step workflow (numbered stepper header, zero stacked tab bars):
	 *    - Step 1: Parse BIM, review/edit proposed Item Matrix & costings, proposed Clean BIM, and Compliance Lints.
	 *    - Step 2: Generate & edit Classification & BOQ Costing Matrix.
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
	import { toNumber } from '../../../services/commercial/decimal.js';
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

	type CostingStep = 'prepare' | 'cost';

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
	let costingStepOverride = $state<CostingStep | null>(null);
	let step1Edited = $state(false);
	let activeRun = $state<{ readonly id: string } | null>(null);
	let startingRun = $state(false);

	const step1Done = $derived(
		record.bim_summary != null && record.bim_takeoff != null && !record.bim_costing_dirty
	);
	const step2Done = $derived(activeEstimate !== null && record.bim_summary?.stage === 'costed');
	const costingStep = $derived<CostingStep>(
		costingStepOverride ?? (step2Done ? 'cost' : 'prepare')
	);

	const figuresSaver = use_act(ctx);
	let bimStreaming = $state(false);
	let bimUploading = $state(false);
	let bimStreamNotice = $state<string | null>(null);
	let bimStreamError = $state<string | null>(null);
	let bimUploadInput = $state<HTMLInputElement | null>(null);

	let editedLines = $state<readonly BimTakeoffLine[] | null>(null);
	let editedContingency = $state<string | null>(null);
	let editedRevision = $state<number | null>(null);

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
		fork(
			ctx.run('analyze_bim_file', { project_id: record.id, phase }).pipe(
				Effect.match({
					onFailure: (error) => {
						startingRun = false;
						toast.error('message' in error ? error.message : String(error));
					},
					onSuccess: (res) => {
						startingRun = false;
						if (res.kind === 'committed') activeRun = { id: res.output.id };
					}
				})
			)
		);
	}

	const takeOff = (projectId: Id<'projects'>, source: File | string) => {
		bimStreamError = null;
		bimStreamNotice = null;
		bimStreaming = true;
		costingStepOverride = 'prepare';
		return storeProjectTakeoff(ctx, projectId, source, (progress) => {
			bimStreamNotice = takeoffProgressText(t, progress);
		}).pipe(
			Effect.match({
				onFailure: (error) => {
					bimStreaming = false;
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

	function runPhase1Prepare() {
		if (!projectBimFile || bimStreaming || startingRun) return;
		costingStepOverride = 'prepare';
		if (record.bim_takeoff == null) {
			fork(takeOff(record.id, ctx.file_url(projectBimFile)));
			return;
		}
		startBimRun('prepare');
	}

	function reParseProjectBim() {
		if (!projectBimFile || bimStreaming || startingRun) return;
		fork(takeOff(record.id, ctx.file_url(projectBimFile)));
	}

	function runPhase2Cost() {
		if (
			!projectBimFile ||
			record.bim_takeoff == null ||
			bimStreaming ||
			startingRun ||
			costingLocked
		)
			return;
		step1Edited = false;
		costingStepOverride = 'cost';
		startBimRun('cost');
	}

	const costingLocked = $derived(
		singleEstimate != null && singleEstimate.status !== 'draft' && singleEstimate.status !== 'void'
	);
	const costingStatus = $derived.by(
		(): { text: string; tone: 'muted' | 'locked' | 'warning' | 'error' | 'busy' } => {
			if (bimStreamError) return { text: bimStreamError, tone: 'error' };
			if (bimStreaming && bimStreamNotice) return { text: bimStreamNotice, tone: 'busy' };
			if (!record.bim_file) return { text: t('bim_costing.status_no_model'), tone: 'muted' };
			if (record.bim_takeoff == null)
				return { text: t('bim_step.status_needs_prepare'), tone: 'warning' };
			if (record.bim_costing_dirty)
				return record.bim_costing_error
					? {
							text: t('bim_costing.status_failed', { reason: record.bim_costing_error }),
							tone: 'error'
						}
					: { text: bimStreamNotice ?? t('bim_step.status_preparing'), tone: 'busy' };
			if (startingRun) return { text: t('bim_costing.status_pricing'), tone: 'busy' };
			if (costingLocked) return { text: t('bim_costing.locked_hint'), tone: 'locked' };
			if (record.bim_summary?.stage === 'prepared' && !activeEstimate)
				return {
					text: t('bim_step.status_prepared_ready', {
						when: format({ kind: 'instant' }, record.bim_summary.analyzed_at, {
							locale: ctx.locale
						})
					}),
					tone: 'muted'
				};
			if (activeEstimate?.analyzed_at)
				return {
					text: t('bim_costing.status_priced', {
						when: format({ kind: 'instant' }, activeEstimate.analyzed_at, { locale: ctx.locale })
					}),
					tone: 'muted'
				};
			return record.bim_summary?.analyzed_at
				? {
						text: t('bim_step.status_prepared_ready', {
							when: format({ kind: 'instant' }, record.bim_summary.analyzed_at, {
								locale: ctx.locale
							})
						}),
						tone: 'muted'
					}
				: { text: t('bim_step.status_needs_prepare'), tone: 'warning' };
		}
	);
	const costingBusy = $derived(bimStreaming || startingRun || costingStatus.tone === 'busy');
	const costingStale = $derived(
		activeEstimate != null && (step1Edited || record.bim_summary?.stage === 'prepared')
	);

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
		{#if canUpdateProject}
			<input
				bind:this={bimUploadInput}
				type="file"
				accept=".ifc,application/octet-stream"
				class="hidden"
				onchange={handleUploadProjectBim}
			/>
		{/if}
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

{#snippet bimCostingTab()}
	<Scroll name={t('bim_costing.estimates_title')} size="fill" inset>
		<Stack gap="md">
			<!-- Repeatable 2-Step Numbered Stepper -->
			<Surface tone="subtle" padding="xs" radius="control">
				<Cluster align="center" justify="between" gap="sm">
					<Cluster align="center" gap="xs">
						<Button
							variant={costingStep === 'prepare' ? 'secondary' : 'ghost'}
							aria-current={costingStep === 'prepare' ? 'step' : undefined}
							onclick={() => (costingStepOverride = 'prepare')}
						>
							<Icon
								name={step1Done ? 'lucide:circle-check' : 'lucide:circle-dot'}
								class={step1Done ? 'size-3.5 text-tone-success-text' : 'size-3.5 text-primary'}
							/>
							{t('bim_step.step1_pill')}
						</Button>
						<Icon name="lucide:chevron-right" class="size-3.5 text-muted-foreground" />
						<Button
							variant={costingStep === 'cost' ? 'secondary' : 'ghost'}
							aria-current={costingStep === 'cost' ? 'step' : undefined}
							onclick={() => (costingStepOverride = 'cost')}
						>
							<Icon
								name={step2Done ? 'lucide:circle-check' : 'lucide:circle'}
								class={step2Done
									? 'size-3.5 text-tone-success-text'
									: 'size-3.5 text-muted-foreground'}
							/>
							{t('bim_step.step2_pill')}
						</Button>
					</Cluster>
					<span class="px-2 text-meta">{t('bim_step.repeatable_hint')}</span>
				</Cluster>
			</Surface>

			{#if costingStep === 'prepare'}
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
					status={costingStatus}
					{activeRun}
					busy={costingBusy}
					canAnalyze={canAnalyzeBim}
					{costingLocked}
					onRunPrepare={runPhase1Prepare}
					onRetakeoff={reParseProjectBim}
					onRunCost={runPhase2Cost}
					onInspect3d={inspect3d}
					onMutated={() => (step1Edited = true)}
				/>
			{:else if estimateQuery.loading && !estimateQuery.current}
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
				</Inline>
			{:else if estimateQuery.error}
				<Alert.Root variant="destructive"
					><Alert.Title>{estimateQuery.error.message}</Alert.Title></Alert.Root
				>
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
										<Button variant="ghost" onclick={() => (costingStepOverride = 'prepare')}>
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
											variant={!figuresDirty &&
											(costingStale ||
												costingStatus.tone === 'warning' ||
												costingStatus.tone === 'error')
												? 'brand'
												: 'outline'}
											disabled={costingBusy ||
												costingLocked ||
												figuresDirty ||
												record.bim_takeoff == null}
											hint={costingLocked
												? t('bim_costing.locked_hint')
												: t('bim_step.run_phase2_hint')}
											onclick={runPhase2Cost}
										>
											{#if costingBusy}
												<Spinner class="size-3.5" />
											{:else}
												<Icon name="lucide:refresh-cw" class="size-3.5" />
											{/if}
											{t('bim_step.regenerate_phase2')}
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
							<p
								class={[
									'flex min-w-0 items-center gap-1.5 text-xs',
									costingStatus.tone === 'error'
										? 'text-destructive'
										: costingStale || costingStatus.tone === 'warning'
											? 'text-warning'
											: 'text-muted-foreground'
								]}
								aria-live="polite"
							>
								{#if costingStatus.tone === 'busy'}
									<Spinner class="size-3.5 shrink-0" />
								{:else}
									<Icon
										name={costingStale
											? 'lucide:triangle-alert'
											: costingStatus.tone === 'muted'
												? 'lucide:circle-check'
												: costingStatus.tone === 'locked'
													? 'lucide:lock'
													: 'lucide:triangle-alert'}
										class="size-3.5 shrink-0"
									/>
								{/if}
								<span class="truncate">
									{costingStale ? t('bim_step.phase1_updated_hint') : costingStatus.text}
								</span>
							</p>
							{#if activeRun}
								<RunStatus {ctx} automation="analyze_bim_file" run={activeRun} />
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
				<EmptyState
					variant="card"
					icon="file"
					title={t('bim_step.phase2_title')}
					hint={record.bim_takeoff != null
						? t('bim_step.phase2_ready_hint')
						: t('bim_step.phase2_needs_phase1')}
				>
					<Cluster gap="xs">
						{#if record.bim_takeoff == null}
							<Button variant="brand" onclick={() => (costingStepOverride = 'prepare')}>
								<Icon name="lucide:arrow-left" class="size-3.5" />
								{t('bim_step.goto_phase1')}
							</Button>
						{:else if canAnalyzeBim && projectBimFile}
							<Button
								variant="brand"
								disabled={costingBusy || costingLocked}
								onclick={runPhase2Cost}
							>
								{#if costingBusy}
									<Spinner class="size-3.5" />
								{:else}
									<Icon name="lucide:calculator" class="size-3.5" />
								{/if}
								{t('bim_step.generate_phase2')}
							</Button>
						{/if}
					</Cluster>
				</EmptyState>
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
