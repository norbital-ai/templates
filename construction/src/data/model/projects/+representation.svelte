<script lang="ts">
	/**
	 * Streamlined Contractor Project Hub (Main Contractor or Subcontractor):
	 * Single-level RecordShell tabs (zero nested scrollports, zero duplicate tables):
	 * - Primary tab (Overview): capped KPI summary strip (up to 5 non-zero KPIs) + model-backed SQL `<Chart>` + editable Project Details form
	 * - Programme: 4D Timeline | Table | Board switcher for `tasks` (+ Autodesk ACC, Primavera P6, MS Project sync)
	 * - BIM & Issues: 3D IFC viewer + BIM-pinned `issues` register (`Focus in 3D` & click-to-tag)
	 * - BIM Costing: automated IFC asset takeoff & non-BIM additional costings (`cost_estimates`)
	 * - Files & BIM: `.ifc` models, Autodesk ACC sheets, drawings & specs (`project_files`)
	 * - Contracts: upstream & downstream contracts + variation orders (`contracts`)
	 * - PO / DO / Invoices: 3-way matched commercial ledger (`commercial_documents`)
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Board,
		Button,
		Chart,
		CustomView,
		EmptyState,
		Field,
		Form,
		Icon,
		RecordShell,
		RunStatus,
		Section,
		Sheet,
		Show,
		Spinner,
		Surface,
		Table,
		Tabs,
		open_record,
		use_act,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import {
		extractBimFromFile,
		extractBimFromUrl,
		type BimTakeoffProgress
	} from '../../../lib/ifc-viewer/ifc_takeoff.js';
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
	import {
		computeProjectCashflow,
		computeProjectCommercial,
		toNumber
	} from '../../../lib/commercial.js';
	import ProjectTimeline from '../../../lib/ProjectTimeline.svelte';
	import RecordForm from '../../../lib/record-form.svelte';
	import type {
		IFCSelectedElement,
		IFCViewerIssueSummary,
		IFCViewerMarkerGroup
	} from '../../../lib/ifc-viewer/ifc_viewer.types.js';

	let { view, ctx }: { view: RecordView<'projects'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const canAnalyzeBim = $derived(
		ctx.catalog?.cost_estimates?.create !== undefined ||
			ctx.catalog?.project_files?.create !== undefined
	);
	const day = ctx.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	const money = { kind: 'money', currency: 'currency' } as const;

	const filesQuery = $derived(
		record &&
			ctx.query({
				project_files: {
					where: {
						project_id: { eq: record.id },
						status: { in: ['draft', 'in_review', 'issued'] }
					},
					fields: ['title', 'document_number', 'kind', 'file', 'current_version'],
					order_by: { updated_at: 'desc' },
					limit: 100
				}
			})
	);

	const issuesQuery = $derived(
		record &&
			ctx.query({
				issues: {
					where: { project_id: { eq: record.id } },
					fields: ['issue_number', 'title', 'severity', 'status', 'bim_pin', 'photos'],
					order_by: { updated_at: 'desc' },
					limit: 300
				}
			})
	);

	const programmeQuery = $derived(
		record &&
			ctx.query({
				tasks: {
					where: { project_id: { eq: record.id } },
					fields: [
						'task_code',
						'wbs_path',
						'parent_task_id',
						'title',
						'is_milestone',
						'trade_specialty',
						'status',
						'priority',
						'progress_pct',
						'schedule_range',
						'bim_express_ids'
					],
					order_by: { wbs_path: 'asc' },
					limit: 500
				},
				contracts: {
					where: { project_id: { eq: record.id } },
					fields: [
						'contract_number',
						'title',
						'direction',
						'contract_type',
						'status',
						'contract_value',
						'schedule_impact_days',
						'signed_date'
					],
					order_by: { created_at: 'asc' },
					limit: 300
				},
				commercial_documents: {
					where: { project_id: { eq: record.id } },
					fields: [
						'doc_type',
						'direction',
						'status',
						'total_amount',
						'certified_amount',
						'net_amount',
						'issue_date',
						'due_date',
						'paid_date'
					],
					order_by: { issue_date: 'asc' },
					limit: 500
				}
			})
	);

	const ifcFiles = $derived(
		(filesQuery?.current?.project_files.rows ?? []).filter(
			(f) =>
				f.file != null && (f.kind === 'ifc_model' || f.file.name.toLowerCase().endsWith('.ifc'))
		)
	);
	let selectedIfcId = $state<string | null>(null);
	const activeIfc = $derived(ifcFiles.find((f) => f.id === selectedIfcId) ?? ifcFiles[0] ?? null);
	const activeIfcSrc = $derived(activeIfc?.file ? ctx.file_url(activeIfc.file) : '');
	const viewer = $derived(activeIfc ? import('../../../lib/ifc-viewer/ifc_viewer.svelte') : null);

	const allIssues = $derived(issuesQuery?.current?.issues.rows ?? []);
	const bimIssues = $derived<IFCViewerIssueSummary[]>(
		allIssues.flatMap((issue) => {
			if (issue.bim_pin == null) return [];
			const pin =
				issue.bim_pin.x != null && issue.bim_pin.y != null && issue.bim_pin.z != null
					? {
							x: issue.bim_pin.x,
							y: issue.bim_pin.y,
							z: issue.bim_pin.z,
							camera_x: issue.bim_pin.camera_x ?? null,
							camera_y: issue.bim_pin.camera_y ?? null,
							camera_z: issue.bim_pin.camera_z ?? null
						}
					: null;
			return [
				{
					id: issue.id,
					issue_number: issue.issue_number,
					title: issue.title,
					severity: issue.severity,
					status: issue.status,
					expressId: issue.bim_pin.express_id,
					photoUrls: (issue.photos ?? []).map((p) => ctx.file_url(p, { preview: 512 })),
					pin
				}
			];
		})
	);
	const bimIssueById = $derived(new Map(bimIssues.map((i) => [i.id, i])));

	let focusIssue = $state<IFCViewerIssueSummary | null>(null);
	let timelineBimHighlight = $state<{ label: string; expressIds: number[] } | null>(null);
	let tasksView = $state<'timeline' | 'table' | 'board'>('timeline');

	const markerGroups = $derived.by<IFCViewerMarkerGroup[]>(() => {
		const groups: IFCViewerMarkerGroup[] = [];
		const openPinned = bimIssues.filter((i) => i.status !== 'closed');
		const critical = openPinned.filter((i) => i.severity === 'critical').map((i) => i.expressId);
		const high = openPinned.filter((i) => i.severity === 'high').map((i) => i.expressId);
		const other = openPinned
			.filter((i) => i.severity !== 'critical' && i.severity !== 'high')
			.map((i) => i.expressId);
		if (critical.length > 0)
			groups.push({
				label: t('bim.legend_critical'),
				color: 'var(--color-tone-destructive-text)',
				expressIds: critical
			});
		if (high.length > 0)
			groups.push({
				label: t('bim.legend_high'),
				color: 'var(--color-tone-warning-text)',
				expressIds: high
			});
		if (other.length > 0)
			groups.push({
				label: t('bim.legend_medium_low'),
				color: 'var(--color-tone-info-text)',
				expressIds: other
			});
		if (timelineBimHighlight && timelineBimHighlight.expressIds.length > 0) {
			groups.push({
				label: t('bim.legend_4d_active', { date: timelineBimHighlight.label }),
				color: 'var(--color-primary)',
				expressIds: timelineBimHighlight.expressIds
			});
		}
		return groups;
	});

	type CreateSheet =
		| null
		| { kind: 'issue'; values: Record<string, unknown> }
		| { kind: 'file' }
		| { kind: 'task' }
		| {
				kind: 'contract';
				direction: 'upstream' | 'downstream';
				contract_type: 'main_contract' | 'subcontract' | 'variation_order';
		  }
		| {
				kind: 'document';
				doc_type?: 'delivery_order' | 'invoice' | 'progress_claim' | 'purchase_order';
		  }
		| { kind: 'estimate' };

	let createSheet = $state<CreateSheet>(null);
	const bimAnalyze = use_act(ctx);
	let bimRunId = $state<string | null>(null);
	let bimStreaming = $state(false);
	let bimStreamNotice = $state<string | null>(null);
	let bimStreamError = $state<string | null>(null);
	let localIfcInput = $state<HTMLInputElement | null>(null);

	function formatBimProgress(progress: BimTakeoffProgress): string {
		if (progress.phase === 'snapshots') {
			return t('bim_costing.snapshots_progress', {
				done: progress.done,
				total: progress.total,
				captured: progress.captured
			});
		}
		return t('bim_costing.streaming_progress', {
			percent: progress.percent,
			assets: progress.rawAssets
		});
	}

	function triggerProjectIfcTakeoff(): void {
		if (!activeIfc || !activeIfc.file || bimStreaming || bimAnalyze.pending) return;
		bimStreamError = null;
		bimStreamNotice = null;
		bimStreaming = true;
		fork(
			extractBimFromUrl(ctx.file_url(activeIfc.file), (progress) => {
				bimStreamNotice = formatBimProgress(progress);
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						bimStreaming = false;
						bimStreamNotice = null;
						bimStreamError = error.message;
					},
					onSuccess: (res) => {
						bimStreaming = false;
						bimStreamNotice = t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							visuals: res.visualCapturedCount,
							ms: res.durationMs
						});
						bimAnalyze.run(
							ctx.run('analyze_bim_file', {
								project_file_id: activeIfc.id,
								extracted_model: res.extracted
							}),
							{
								then: (handle) => {
									bimRunId = handle.output.id;
								}
							}
						);
					}
				})
			)
		);
	}

	function handleProjectLocalIfcSelected(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;
		const file = target.files?.[0];
		target.value = '';
		if (!file || !id || bimStreaming || bimAnalyze.pending) return;
		bimStreamError = null;
		bimStreamNotice = null;
		bimStreaming = true;
		const baseTitle = file.name.replace(/\.ifc$/i, '').trim() || 'Local BIM Model';
		fork(
			extractBimFromFile(file, (progress) => {
				bimStreamNotice = formatBimProgress(progress);
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						bimStreaming = false;
						bimStreamNotice = null;
						bimStreamError = error.message;
					},
					onSuccess: (res) => {
						bimStreaming = false;
						bimStreamNotice = t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							visuals: res.visualCapturedCount,
							ms: res.durationMs
						});
						bimAnalyze.run(
							ctx.run('analyze_bim_file', {
								project_id: id,
								title: `${baseTitle} — BIM Cost Estimate`,
								extracted_model: res.extracted
							}),
							{
								then: (handle) => {
									bimRunId = handle.output.id;
								}
							}
						);
					}
				})
			)
		);
	}

	function handleTagIssueFromBim(element: IFCSelectedElement): void {
		if (!record) return;
		const elementName = element.subtitle ? `${element.subtitle} · ${element.title}` : element.title;
		createSheet = {
			kind: 'issue',
			values: {
				project_id: record.id,
				...(activeIfc ? { bim_file_id: activeIfc.id } : {}),
				bim_pin: {
					express_id: element.expressId,
					element_name: elementName,
					global_id: element.globalId ?? null,
					x: element.pin?.x ?? null,
					y: element.pin?.y ?? null,
					z: element.pin?.z ?? null,
					camera_x: element.pin?.camera_x ?? null,
					camera_y: element.pin?.camera_y ?? null,
					camera_z: element.pin?.camera_z ?? null
				}
			}
		};
	}

	const allContracts = $derived(programmeQuery?.current?.contracts.rows ?? []);
	const variations = $derived(allContracts.filter((c) => c.contract_type === 'variation_order'));

	const commercial = $derived(
		record && programmeQuery?.current
			? computeProjectCommercial({
					contract_value: record.contract_value,
					retention_rate: record.retention_rate,
					retention_cap_rate: record.retention_cap_rate,
					tax_rate: record.tax_rate,
					contracts: allContracts,
					tasks: programmeQuery.current.tasks.rows,
					documents: programmeQuery.current.commercial_documents.rows
				})
			: null
	);

	const cashflow = $derived(
		programmeQuery?.current
			? computeProjectCashflow(programmeQuery.current.commercial_documents.rows, day.today)
			: null
	);

	const addressLine = $derived(
		[
			record?.address?.line_1,
			record?.address?.line_2,
			record?.address?.city,
			record?.address?.state,
			record?.address?.postal_code,
			record?.address?.country
		]
			.filter(Boolean)
			.join(', ')
	);
	const hasAnyKpi = $derived(
		commercial !== null &&
			cashflow !== null &&
			(toNumber(commercial.revised_contract_sum) !== 0 ||
				toNumber(commercial.committed_downstream) !== 0 ||
				toNumber(cashflow.net_projected_cashflow) !== 0 ||
				toNumber(commercial.projected_margin_pct) !== 0 ||
				toNumber(commercial.overall_progress_pct) !== 0)
	);
</script>

{#snippet projectSections()}
	<Section icon="lucide:building-2" first name="project" title={t('section.project')}>
		<Grid minimum="card">
			<Field {ctx} name="project_name" />
			<Field {ctx} name="project_number" />
			<Field {ctx} name="project_role" />
			<Field {ctx} name="client" />
			<Field {ctx} name="main_contractor" />
			<Field {ctx} name="project_manager" />
			<Field {ctx} name="project_type" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="autodesk_project_id" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>

	<Section icon="lucide:calculator" name="commercial" title={t('section.schedule_and_value')}>
		<Grid minimum="card">
			<Field {ctx} name="schedule_range" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="contract_value" />
			<Field {ctx} name="retention_rate" />
			<Field {ctx} name="retention_cap_rate" />
			<Field {ctx} name="tax_rate" />
			<Field {ctx} name="payment_terms_days" />
		</Grid>
	</Section>

	<Section
		icon="lucide:layers"
		name="zones"
		title={t('section.zones')}
		default_open={false}
		{...record?.zones?.length
			? { summary: t('zones.count_summary', { count: record.zones.length }) }
			: {}}
	>
		<Field {ctx} name="zones" />
	</Section>

	<Section
		icon="lucide:message-square-text"
		name="capture"
		title={t('section.capture_rules')}
		default_open={false}
		{...record?.capture_rules ? { summary: t('section.configured') } : {}}
	>
		<Field {ctx} name="capture_rules" />
	</Section>

	<Section
		icon="lucide:map-pin"
		name="address"
		title={t('section.address')}
		default_open={false}
		{...addressLine ? { summary: addressLine } : {}}
	>
		<Field {ctx} name="address" />
	</Section>
{/snippet}

{#snippet tasksControls()}
	<Button
		variant={tasksView === 'timeline' ? 'secondary' : 'ghost'}
		onclick={() => (tasksView = 'timeline')}
	>
		<Icon name="lucide:gantt-chart" class="size-3.5" />
		{t('programme.view_timeline')}
	</Button>
	<Button
		variant={tasksView === 'table' ? 'secondary' : 'ghost'}
		onclick={() => (tasksView = 'table')}
	>
		<Icon name="lucide:table-2" class="size-3.5" />
		{t('component.view_table')}
	</Button>
	<Button
		variant={tasksView === 'board' ? 'secondary' : 'ghost'}
		onclick={() => (tasksView = 'board')}
	>
		<Icon name="lucide:columns-3" class="size-3.5" />
		{t('component.view_board')}
	</Button>
{/snippet}

{#snippet programmeTab()}
	{#if id && record}
		{#if tasksView === 'table'}
			<Table
				{ctx}
				of="tasks"
				key={`project:tasks:${id}`}
				where={{ project_id: { eq: id } }}
				order_by={{ task_code: 'asc' }}
				toolbar={{
					title: t('programme.tasks_title'),
					controls: tasksControls,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
				columns={[
					'task_code',
					'wbs_path',
					'parent_task_id',
					'title',
					'trade_specialty',
					'subcontractor_id',
					'status',
					'progress_pct',
					'schedule_range',
					'latest_update'
				]}
			/>
		{:else if tasksView === 'board'}
			<Board
				{ctx}
				of="tasks"
				key={`project:tasks:board:${id}`}
				where={{ project_id: { eq: id } }}
				by="status"
				lanes={['todo', 'in_progress', 'blocked', 'done']}
				card={['title', 'trade_specialty', 'priority', 'progress_pct']}
				toolbar={{
					title: t('programme.tasks_title'),
					controls: tasksControls,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
			/>
		{:else if programmeQuery?.loading && !programmeQuery.current}
			<Bound size="content" inset>
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_programme')}</span>
				</Inline>
			</Bound>
		{:else if programmeQuery?.error}
			<Bound size="content" inset>
				<Alert.Root variant="destructive">
					<Alert.Title>{programmeQuery.error.message}</Alert.Title>
				</Alert.Root>
			</Bound>
		{:else}
			<CustomView
				{ctx}
				model="tasks"
				of={programmeQuery?.current?.tasks.rows ?? []}
				fields={['task_code', 'title', 'trade_specialty', 'status', 'priority']}
				key={`project:timeline:${id}`}
				empty={false}
				toolbar={{
					title: t('programme.tasks_title'),
					controls: tasksControls,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
			>
				{#snippet children(shownTasks)}
					<Scroll name={t('programme.tasks_title')} size="fill" inset>
						<ProjectTimeline
							{ctx}
							projectRange={record.schedule_range}
							tasks={shownTasks}
							{variations}
							today={day.today}
							onInspectBim={(expressIds, label) => {
								timelineBimHighlight = { label, expressIds: [...expressIds] };
							}}
						/>
					</Scroll>
				{/snippet}
			</CustomView>
		{/if}
	{/if}
{/snippet}

{#snippet bimViewerPane()}
	<Stack gap="sm" size="fill">
		<Cluster align="center" justify="between" gap="sm">
			<h3 class="text-heading">{t('component.coordination_model')}</h3>
			{#if ifcFiles.length > 1}
				<Cluster gap="xs">
					{#each ifcFiles as f (f.id)}
						<Button
							variant={activeIfc?.id === f.id ? 'secondary' : 'outline'}
							onclick={() => (selectedIfcId = f.id)}
						>
							{`${f.title} (${f.current_version})`}
						</Button>
					{/each}
				</Cluster>
			{/if}
		</Cluster>

		{#if filesQuery?.error}
			<Alert.Root variant="destructive">
				<Alert.Title>{filesQuery.error.message}</Alert.Title>
			</Alert.Root>
		{:else if issuesQuery?.error}
			<Alert.Root variant="destructive">
				<Alert.Title>{issuesQuery.error.message}</Alert.Title>
			</Alert.Root>
		{/if}

		{#if timelineBimHighlight}
			<Surface tone="subtle" padding="xs" radius="control">
				<Inline align="center" justify="between" gap="sm">
					<span class="text-micro">
						{t('bim.showing_4d_slice', { date: timelineBimHighlight.label })}
					</span>
					<Button variant="ghost" onclick={() => (timelineBimHighlight = null)}>
						{t('component.clear_filter')}
					</Button>
				</Inline>
			</Surface>
		{/if}

		{#if filesQuery?.loading && !filesQuery.current}
			<Inline gap="sm" align="center" justify="center" size="fill" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading_viewer')}</span>
			</Inline>
		{:else if activeIfc && viewer && activeIfcSrc}
			{#await viewer}
				<Inline align="center" justify="center" size="fill" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_viewer')}</span>
				</Inline>
			{:then mod}
				<mod.default
					t={ctx.t}
					translateKey={rawT}
					src={activeIfcSrc}
					alt={activeIfc.title}
					{markerGroups}
					issues={bimIssues}
					{focusIssue}
					{...ctx.catalog?.issues?.create !== undefined
						? { onTagIssue: handleTagIssueFromBim }
						: {}}
					onOpenIssue={(issueId) => open_record('issues', issueId)}
				/>
			{:catch error}
				<Alert.Root variant="destructive">
					<Alert.Title>{String(error)}</Alert.Title>
				</Alert.Root>
			{/await}
		{:else}
			<EmptyState
				variant="card"
				icon="file"
				title={t('component.no_ifc_model')}
				hint={t('component.link_ifc_document')}
			/>
		{/if}
	</Stack>
{/snippet}

{#snippet bimIssuesTable()}
	{#if id}
		<Table
			{ctx}
			of="issues"
			key={`project:issues:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('component.issues_register'),
				new: ctx.catalog?.issues?.create
					? () =>
							(createSheet = {
								kind: 'issue',
								values: { project_id: id, ...(activeIfc ? { bim_file_id: activeIfc.id } : {}) }
							})
					: false
			}}
			columns={[
				'issue_number',
				'title',
				'kind',
				'trade_specialty',
				'severity',
				'status',
				'zone',
				'bim_pin'
			]}
		>
			{#snippet row_trailing(row)}
				{@const match = bimIssueById.get(String(row.id))}
				{#if match}
					<Button
						variant="ghost"
						onclick={(e) => {
							e.stopPropagation();
							focusIssue = { ...match };
						}}
					>
						{t('bim.focus_in_3d')}
					</Button>
				{/if}
			{/snippet}
		</Table>
	{/if}
{/snippet}

{#snippet bimIssuesTab()}
	<Bound size="fill" inset>
		<Split
			size="fill"
			ratio="wide"
			collapse="switch"
			switch_labels={[t('component.coordination_model'), t('component.issues_register')]}
			start={bimViewerPane}
			end={bimIssuesTable}
		/>
	</Bound>
{/snippet}

{#snippet estimatesTab()}
	{#if id}
		<Stack gap="sm">
			{#if canAnalyzeBim}
				<input
					bind:this={localIfcInput}
					type="file"
					accept=".ifc,application/octet-stream"
					class="hidden"
					onchange={handleProjectLocalIfcSelected}
				/>
			{/if}
			{#if bimStreamError}
				<Alert.Root variant="destructive">
					<Alert.Title>{bimStreamError}</Alert.Title>
				</Alert.Root>
			{:else if bimStreamNotice}
				<Alert.Root>
					<Alert.Title>{bimStreamNotice}</Alert.Title>
				</Alert.Root>
			{/if}
			{#if bimRunId}
				<RunStatus {ctx} automation="analyze_bim_file" run={bimRunId} />
			{/if}
			<Table
				{ctx}
				of="cost_estimates"
				key={`project:estimates:${id}`}
				where={{ project_id: { eq: id } }}
				order_by={{ updated_at: 'desc' }}
				toolbar={{
					title: t('bim_costing.estimates_title'),
					actions: canAnalyzeBim
						? [
								...(activeIfc
									? [
											{
												icon: 'lucide:scan-line',
												name: t('bim_costing.run_pipeline'),
												description: t('bim_costing.run_pipeline_desc'),
												run: () => triggerProjectIfcTakeoff()
											}
										]
									: []),
								{
									icon: 'lucide:upload',
									name: t('bim_costing.scan_local_ifc'),
									description: t('bim_costing.scan_local_ifc_desc'),
									run: () => localIfcInput?.click()
								}
							]
						: [],
					new: ctx.catalog?.cost_estimates?.create
						? () => (createSheet = { kind: 'estimate' })
						: false
				}}
				columns={[
					'estimate_number',
					'title',
					'bim_file_id',
					'status',
					'classified_asset_count',
					'unmatched_asset_count',
					'bim_subtotal',
					'additional_subtotal',
					'total_estimate'
				]}
			/>
		</Stack>
	{/if}
{/snippet}

{#snippet filesTab()}
	{#if id}
		<Table
			{ctx}
			of="project_files"
			key={`project:files:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('project_files.register_title'),
				new: ctx.catalog?.project_files?.create ? () => (createSheet = { kind: 'file' }) : false
			}}
			columns={[
				'document_number',
				'title',
				'kind',
				'discipline',
				'current_version',
				'status',
				'zone'
			]}
		/>
	{/if}
{/snippet}

{#snippet bimTab()}
	<Tabs
		level={2}
		tabs={[
			{
				name: 'model',
				title: t('bim.tab_model_issues'),
				icon: 'lucide:box',
				body: bimIssuesTab
			},
			{
				name: 'estimates',
				title: t('bim_costing.estimates_title'),
				icon: 'lucide:calculator',
				body: estimatesTab
			},
			{
				name: 'files',
				title: t('project_files.register_title'),
				icon: 'lucide:file-box',
				body: filesTab
			}
		]}
	/>
{/snippet}

{#snippet salesOrdersTab()}
	{#if id}
		<Table
			{ctx}
			of="contracts"
			key={`project:so:${id}`}
			where={{
				project_id: { eq: id },
				direction: { eq: 'upstream' },
				contract_type: { ne: 'variation_order' }
			}}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_so'),
				new: ctx.catalog?.contracts?.create
					? () =>
							(createSheet = {
								kind: 'contract',
								direction: 'upstream',
								contract_type: 'main_contract'
							})
					: false
			}}
			columns={[
				'contract_number',
				'title',
				'contract_type',
				'contact_id',
				'status',
				'contract_value',
				'signed_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet purchaseOrdersTab()}
	{#if id}
		<Table
			{ctx}
			of="contracts"
			key={`project:po:${id}`}
			where={{
				project_id: { eq: id },
				direction: { eq: 'downstream' },
				contract_type: { ne: 'variation_order' }
			}}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_po'),
				new: ctx.catalog?.contracts?.create
					? () =>
							(createSheet = {
								kind: 'contract',
								direction: 'downstream',
								contract_type: 'subcontract'
							})
					: false
			}}
			columns={[
				'contract_number',
				'title',
				'contract_type',
				'trade_specialty',
				'contact_id',
				'status',
				'contract_value',
				'signed_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet variationOrdersTab()}
	{#if id}
		<Table
			{ctx}
			of="contracts"
			key={`project:vo:${id}`}
			where={{ project_id: { eq: id }, contract_type: { eq: 'variation_order' } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_vo'),
				new: ctx.catalog?.contracts?.create
					? () =>
							(createSheet = {
								kind: 'contract',
								direction: 'upstream',
								contract_type: 'variation_order'
							})
					: false
			}}
			columns={[
				'contract_number',
				'title',
				'direction',
				'trade_specialty',
				'parent_contract_id',
				'contact_id',
				'status',
				'contract_value',
				'schedule_impact_days'
			]}
		/>
	{/if}
{/snippet}

{#snippet transactionsTab()}
	{#if id}
		<Table
			{ctx}
			of="commercial_documents"
			key={`project:tx:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ issue_date: 'desc' }}
			toolbar={{
				title: t('commercial.tab_transactions'),
				actions:
					ctx.catalog?.commercial_documents?.create !== undefined
						? [
								{
									icon: 'lucide:truck',
									name: t('commercial.new_do'),
									run: () => {
										createSheet = { kind: 'document', doc_type: 'delivery_order' };
									}
								},
								{
									icon: 'lucide:receipt',
									name: t('commercial.new_invoice'),
									run: () => {
										createSheet = { kind: 'document', doc_type: 'invoice' };
									}
								},
								{
									icon: 'lucide:file-plus-2',
									name: t('commercial.draft_claim'),
									description: t('commercial.draft_claim_desc'),
									run: () => ctx.run('generate_payment_claim', { project_id: id })
								}
							]
						: [],
				new: ctx.catalog?.commercial_documents?.create
					? () => (createSheet = { kind: 'document', doc_type: 'invoice' })
					: false
			}}
			columns={[
				'document_number',
				'doc_type',
				'direction',
				'external_reference',
				'contract_id',
				'contact_id',
				'status',
				'match_status',
				'total_amount',
				'net_amount',
				'due_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet commercialTab()}
	<Tabs
		level={2}
		tabs={[
			{
				name: 'so',
				title: t('commercial.tab_so'),
				icon: 'lucide:arrow-down-left',
				body: salesOrdersTab
			},
			{
				name: 'po',
				title: t('commercial.tab_po'),
				icon: 'lucide:arrow-up-right',
				body: purchaseOrdersTab
			},
			{
				name: 'vo',
				title: t('commercial.tab_vo'),
				icon: 'lucide:file-diff',
				body: variationOrdersTab
			},
			{
				name: 'transactions',
				title: t('commercial.tab_transactions'),
				icon: 'lucide:receipt',
				body: transactionsTab
			}
		]}
	/>
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="projects"
		mode={view.mode}
		id={record.id}
		subtitle={['project_role', 'client', 'status']}
		tabs={[
			{
				name: 'programme',
				title: t('programme.tasks_title'),
				icon: 'lucide:gantt-chart',
				body: programmeTab
			},
			{
				name: 'bim',
				title: t('project.tab_bim'),
				icon: 'lucide:box',
				body: bimTab
			},
			{
				name: 'commercial',
				title: t('project.tab_commercial'),
				icon: 'lucide:banknote',
				body: commercialTab
			}
		]}
	>
		<Stack gap="lg">
			<Surface tone="card" padding="md" radius="control">
				<Stack gap="md" divided>
					<Cluster align="center" justify="between" gap="sm">
						<p class="text-overline">{t('cashflow.title')}</p>
						<Cluster gap="xs">
							{#if cashflow && toNumber(cashflow.overdue_receivables) > 0}
								<Badge variant="warning">
									{t('cashflow.overdue_in', { amount: cashflow.overdue_receivables })}
								</Badge>
							{/if}
							{#if cashflow && toNumber(cashflow.overdue_payables) > 0}
								<Badge variant="destructive">
									{t('cashflow.overdue_out', { amount: cashflow.overdue_payables })}
								</Badge>
							{/if}
							{#if (record.open_task_count ?? 0) > 0 || (record.open_issue_count ?? 0) > 0}
								<Badge variant="outline">
									{t('component.tasks_issues_pair', {
										tasks: record.open_task_count ?? 0,
										issues: record.open_issue_count ?? 0
									})}
								</Badge>
							{/if}
						</Cluster>
					</Cluster>

					{#if programmeQuery?.loading && !programmeQuery.current}
						<Inline gap="sm" align="center" aria-busy="true">
							<Spinner />
							<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
						</Inline>
					{:else if programmeQuery?.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{programmeQuery.error.message}</Alert.Title>
						</Alert.Root>
					{:else if commercial && cashflow && hasAnyKpi}
						<Grid minimum="card" gap="md">
							{#if toNumber(commercial.revised_contract_sum) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('commercial.revised_contract_sum')}</span>
									<span class="text-label tabular-nums">
										<Show
											{ctx}
											kind={money}
											value={commercial.revised_contract_sum}
											row={{ currency: record.currency }}
										/>
									</span>
								</Stack>
							{/if}
							{#if toNumber(commercial.committed_downstream) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('commercial.committed_subcon')}</span>
									<span class="text-label tabular-nums">
										<Show
											{ctx}
											kind={money}
											value={commercial.committed_downstream}
											row={{ currency: record.currency }}
										/>
									</span>
								</Stack>
							{/if}
							{#if toNumber(cashflow.net_projected_cashflow) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('cashflow.net_projected')}</span>
									<span class="text-label tabular-nums">
										<Show
											{ctx}
											kind={money}
											value={cashflow.net_projected_cashflow}
											row={{ currency: record.currency }}
										/>
									</span>
								</Stack>
							{/if}
							{#if toNumber(commercial.projected_margin_pct) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('commercial.projected_margin')}</span>
									<span class="text-label tabular-nums">
										{t('commercial.margin_pct_value', { pct: commercial.projected_margin_pct })}
									</span>
								</Stack>
							{/if}
							{#if toNumber(commercial.overall_progress_pct) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('commercial.overall_progress')}</span>
									<span class="text-sm font-medium tabular-nums text-primary">
										{commercial.overall_progress_pct}%
									</span>
								</Stack>
							{/if}
						</Grid>
					{/if}

					<Bound height="18rem">
						<Chart
							{ctx}
							of="commercial_documents"
							where={{ project_id: { eq: record.id }, status: { ne: 'cancelled' } }}
							x="doc_type"
							y="sum.net_amount"
							kind="bar"
							title={t('cashflow.ledger_chart')}
						/>
					</Bound>
				</Stack>
			</Surface>

			<Form {ctx} of="projects" mode={view.mode} id={record.id} {record} size="content">
				{@render projectSections()}
			</Form>
		</Stack>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['project_role', 'client', 'status']}>
		{@render projectSections()}
	</RecordForm>
{/if}

<Sheet open={createSheet !== null} on_open_change={(open) => !open && (createSheet = null)}>
	{#if createSheet?.kind === 'issue'}
		<RecordShell
			{ctx}
			of="issues"
			mode="create"
			values={createSheet.values}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'file' && id}
		<RecordShell
			{ctx}
			of="project_files"
			mode="create"
			values={{ project_id: id }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'task' && id}
		<RecordShell
			{ctx}
			of="tasks"
			mode="create"
			values={{ project_id: id }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'contract' && id}
		<RecordShell
			{ctx}
			of="contracts"
			mode="create"
			values={{
				project_id: id,
				direction: createSheet.direction,
				contract_type: createSheet.contract_type,
				currency: record?.currency ?? 'SGD'
			}}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'document' && id}
		<RecordShell
			{ctx}
			of="commercial_documents"
			mode="create"
			values={{
				project_id: id,
				...(createSheet.doc_type ? { doc_type: createSheet.doc_type } : {}),
				currency: record?.currency ?? 'SGD'
			}}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'estimate' && id}
		<RecordShell
			{ctx}
			of="cost_estimates"
			mode="create"
			values={{
				project_id: id,
				currency: record?.currency ?? 'SGD',
				...(activeIfc ? { bim_file_id: activeIfc.id } : {})
			}}
			on_done={() => (createSheet = null)}
		/>
	{/if}
</Sheet>
