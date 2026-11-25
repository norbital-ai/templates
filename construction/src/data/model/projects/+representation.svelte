<script lang="ts">
	/**
	 * Streamlined Contractor Project Hub (Main Contractor or Subcontractor):
	 * - Record: commercial & cashflow pulse + Project Details + BIM Model slot + Filed Documents section
	 * - Programme & Tasks: icon-only Timeline | Table | Board switcher flush right beside +New; simplified scannable Board cards
	 * - BIM (keep_alive): 3D Model & Issues (single project IFC model, no redundant heading) + single inline BIM Costing
	 * - Commercial: Sales Orders (SO), Purchase Orders (PO), Ad-hoc Costs (VOs & Transactions live inside each SO/PO)
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { create_toggle_group } from '@norbital-ai/ui/behaviors';
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
		enum_text,
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
		computeCatalogCashflowBreakdown,
		computeProjectCashflow,
		computeProjectCommercial,
		toNumber
	} from '../../../lib/commercial.js';
	import ProjectTimeline from '../../../lib/ProjectTimeline.svelte';
	import RecordForm from '../../../lib/record-form.svelte';
	import BimTakeoffRenderer from '../../custom_field/bim_takeoff/+renderer.svelte';
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
	const canAnalyzeBim = $derived(ctx.catalog?.cost_estimates?.update !== undefined);
	const canUpdateProject = $derived(ctx.catalog?.projects?.update !== undefined);
	const day = ctx.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	const money = { kind: 'money', currency: 'currency' } as const;

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

	const estimateQuery = $derived(
		record &&
			ctx.query({
				cost_estimates: {
					where: { project_id: { eq: record.id } },
					fields: [
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
						'analyzed_at'
					],
					limit: 1
				}
			})
	);

	const tasksQuery = $derived(
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
						'zone',
						'trade_specialty',
						'subcontractor_id',
						'status',
						'priority',
						'progress_pct',
						'schedule_range',
						'bim_express_ids',
						'latest_update',
						'last_updated_on'
					],
					order_by: { wbs_path: 'asc' },
					limit: 2000
				}
			})
	);

	const commercialQuery = $derived(
		record &&
			ctx.query({
				contracts: {
					where: { project_id: { eq: record.id } },
					fields: [
						'contract_number',
						'title',
						'direction',
						'contract_type',
						'status',
						'contract_value',
						'lines',
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
						'lines',
						'total_amount',
						'certified_amount',
						'net_amount',
						'issue_date',
						'due_date',
						'paid_date'
					],
					order_by: { issue_date: 'asc' },
					limit: 500
				},
				adhoc_costs: {
					where: { project_id: { eq: record.id } },
					fields: ['status', 'title', 'unit', 'amount', 'catalog_item_id'],
					limit: 300
				},
				cost_matrix: {
					fields: ['code', 'name'],
					limit: 500
				}
			})
	);

	const projectBimFile = $derived(record?.bim_file ?? null);
	const activeIfcSrc = $derived(projectBimFile ? ctx.file_url(projectBimFile) : '');
	const viewer = $derived(
		projectBimFile ? import('../../../lib/ifc-viewer/ifc_viewer.svelte') : null
	);
	const singleEstimate = $derived(estimateQuery?.current?.cost_estimates.rows[0] ?? null);

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
	const tasksViewGroup = create_toggle_group({
		items: () => ['timeline', 'table', 'board'],
		mode: 'single',
		value: () => [tasksView],
		on_change: (values) => {
			const next = values[0];
			if (next === 'timeline' || next === 'table' || next === 'board') tasksView = next;
		},
		control: { id: 'construction:tasks-view', label: 'Programme view' }
	});

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
				contract_type: 'main_contract' | 'subcontract';
		  }
		| { kind: 'adhoc_cost' };

	let createSheet = $state<CreateSheet>(null);
	const bimAnalyze = use_act(ctx);
	let bimRunId = $state<string | null>(null);
	let bimStreaming = $state(false);
	let bimUploading = $state(false);
	let bimStreamNotice = $state<string | null>(null);
	let bimStreamError = $state<string | null>(null);
	let localIfcInput = $state<HTMLInputElement | null>(null);
	let bimUploadInput = $state<HTMLInputElement | null>(null);

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

	function handleUploadProjectBim(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;
		const file = target.files?.[0];
		target.value = '';
		if (!file || !record || bimUploading) return;
		bimStreamError = null;
		bimUploading = true;
		const projectId = record.id;
		const revision = record.revision;
		fork(
			ctx.upload(file, 'projects.bim_file').pipe(
				Effect.flatMap((fileRef) =>
					ctx.act({
						'projects.update': [
							{
								target: { id: projectId, revision },
								set: { bim_file: fileRef }
							}
						]
					})
				),
				Effect.match({
					onFailure: (error) => {
						bimUploading = false;
						bimStreamError = 'message' in error ? error.message : String(error);
					},
					onSuccess: () => {
						bimUploading = false;
					}
				})
			)
		);
	}

	function triggerProjectIfcTakeoff(): void {
		if (!record || !projectBimFile || bimStreaming || bimAnalyze.pending) return;
		bimStreamError = null;
		bimStreamNotice = null;
		bimStreaming = true;
		const projectId = record.id;
		fork(
			extractBimFromUrl(ctx.file_url(projectBimFile), (progress) => {
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
								project_id: projectId,
								...(singleEstimate ? { estimate_id: singleEstimate.id } : {}),
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
								...(singleEstimate ? { estimate_id: singleEstimate.id } : {}),
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

	const allContracts = $derived(commercialQuery?.current?.contracts.rows ?? []);

	const commercial = $derived(
		record && commercialQuery?.current
			? computeProjectCommercial({
					contract_value: record.contract_value,
					retention_rate: record.retention_rate,
					retention_cap_rate: record.retention_cap_rate,
					tax_rate: record.tax_rate,
					contracts: allContracts,
					tasks: tasksQuery?.current?.tasks.rows ?? [],
					documents: commercialQuery.current.commercial_documents.rows
				})
			: null
	);

	const cashflow = $derived(
		commercialQuery?.current
			? computeProjectCashflow(commercialQuery.current.commercial_documents.rows, day.today)
			: null
	);

	const catalogCashflow = $derived.by(() => {
		const data = commercialQuery?.current;
		if (!data || !record) return null;
		const matrixById = new Map(data.cost_matrix.rows.map((m) => [m.id, m] as const));
		const activeBimAssets =
			singleEstimate && singleEstimate.status !== 'void' ? (singleEstimate.bim_assets ?? []) : [];
		return computeCatalogCashflowBreakdown({
			bim_assets: activeBimAssets,
			adhoc_costs: data.adhoc_costs.rows.map((c) => {
				const cat = matrixById.get(c.catalog_item_id);
				return {
					status: c.status,
					catalog_code: cat?.code ?? null,
					catalog_name: cat?.name ?? null,
					title: c.title,
					unit: c.unit,
					amount: c.amount
				};
			}),
			contracts: data.contracts.rows,
			documents: data.commercial_documents.rows
		});
	});

	const catalogLedgerRows = $derived(
		(catalogCashflow?.rows ?? []).map((r) => ({
			...r,
			id: r.code,
			source_label:
				r.source === 'adhoc_catalog'
					? t('priced_lines.badge_catalog')
					: t('priced_lines.badge_bim'),
			currency: record?.currency ?? 'SGD'
		}))
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
	const bimModelSummary = $derived(
		projectBimFile
			? [projectBimFile.name, record?.bim_version].filter(Boolean).join(' · ')
			: undefined
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
		icon="lucide:box"
		name="bim_model"
		title={t('section.bim_model')}
		default_open={false}
		{...bimModelSummary ? { summary: bimModelSummary } : {}}
	>
		<Grid minimum="card">
			<Field {ctx} name="bim_version" />
			<Column span="all"><Field {ctx} name="bim_file" /></Column>
			{#if record?.bim_summary != null}
				<Column span="all"><Field {ctx} name="bim_summary" readonly /></Column>
			{/if}
			{#if record?.bim_revisions && record.bim_revisions.length > 0}
				<Column span="all"><Field {ctx} name="bim_revisions" readonly /></Column>
			{/if}
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

{#snippet tasksViewToggle()}
	<div
		class="inline-flex items-center rounded-control border border-border bg-muted/40 p-0.5"
		{...tasksViewGroup.root_attrs()}
		aria-label={t('programme.view_switcher')}
	>
		<Button
			{...tasksViewGroup.item_attrs('timeline')}
			{@attach tasksViewGroup.item('timeline')}
			size="icon"
			variant={tasksView === 'timeline' ? 'secondary' : 'ghost'}
			class="size-7"
			aria-label={t('programme.view_timeline')}
			hint={t('programme.view_timeline')}
		>
			<Icon name="lucide:gantt-chart" class="size-3.5" />
		</Button>
		<Button
			{...tasksViewGroup.item_attrs('table')}
			{@attach tasksViewGroup.item('table')}
			size="icon"
			variant={tasksView === 'table' ? 'secondary' : 'ghost'}
			class="size-7"
			aria-label={t('component.view_table')}
			hint={t('component.view_table')}
		>
			<Icon name="lucide:table-2" class="size-3.5" />
		</Button>
		<Button
			{...tasksViewGroup.item_attrs('board')}
			{@attach tasksViewGroup.item('board')}
			size="icon"
			variant={tasksView === 'board' ? 'secondary' : 'ghost'}
			class="size-7"
			aria-label={t('component.view_board')}
			hint={t('component.view_board')}
		>
			<Icon name="lucide:columns-3" class="size-3.5" />
		</Button>
	</div>
{/snippet}

{#snippet taskBoardCard({
	row
}: {
	row: {
		readonly title?: unknown;
		readonly task_code?: unknown;
		readonly trade_specialty?: unknown;
		readonly subcontractor_id?: unknown;
		readonly priority?: unknown;
		readonly progress_pct?: unknown;
		readonly is_milestone?: unknown;
		readonly latest_update?: unknown;
		readonly last_updated_on?: unknown;
	};
})}
	{@const title = typeof row.title === 'string' ? row.title : ''}
	{@const code = typeof row.task_code === 'string' ? row.task_code : ''}
	{@const trade = typeof row.trade_specialty === 'string' ? row.trade_specialty : ''}
	{@const subconObj =
		row.subcontractor_id && typeof row.subcontractor_id === 'object' ? row.subcontractor_id : null}
	{@const subcon =
		subconObj &&
		'company_name' in subconObj &&
		typeof subconObj.company_name === 'string' &&
		subconObj.company_name.trim()
			? subconObj.company_name.trim()
			: subconObj && 'full_name' in subconObj && typeof subconObj.full_name === 'string'
				? subconObj.full_name.trim()
				: ''}
	{@const priority = typeof row.priority === 'string' ? row.priority : ''}
	{@const isMilestone = row.is_milestone === true}
	{@const pct = Math.round(
		toNumber(
			typeof row.progress_pct === 'string' || typeof row.progress_pct === 'number'
				? row.progress_pct
				: 0
		)
	)}
	{@const latestUpdate = typeof row.latest_update === 'string' ? row.latest_update.trim() : ''}
	{@const updatedOn = typeof row.last_updated_on === 'string' ? row.last_updated_on : ''}
	<div class="flex flex-col gap-1 pr-4">
		<div class="flex items-center gap-1">
			{#if isMilestone}
				<Icon name="lucide:diamond" class="size-2.5 shrink-0 text-tone-warning-text" />
			{:else if priority === 'critical'}
				<span
					class="size-1.5 shrink-0 rounded-full bg-destructive"
					title={enum_text(priority, { t: rawT, model: 'tasks', field: 'priority' })}
				></span>
			{:else if priority === 'high'}
				<span
					class="size-1.5 shrink-0 rounded-full bg-warning"
					title={enum_text(priority, { t: rawT, model: 'tasks', field: 'priority' })}
				></span>
			{/if}
			<p class="min-w-0 flex-1 truncate text-xs font-medium leading-tight text-foreground" {title}>
				{title}
			</p>
			{#if !isMilestone}
				<span class="shrink-0 text-tiny font-medium tabular-nums text-muted-foreground">{pct}%</span
				>
			{/if}
		</div>
		<div class="flex items-center justify-between gap-1.5 text-tiny text-muted-foreground">
			<span class="min-w-0 truncate">
				{#if code}<span class="font-mono">{code}</span>{/if}
				{#if code && (subcon || trade)}
					·
				{/if}
				{#if subcon}
					{subcon}
				{:else if trade}
					{enum_text(trade, { t: rawT, model: 'tasks', field: 'trade_specialty' })}
				{/if}
			</span>
			{#if updatedOn}
				<span class="shrink-0 font-mono tabular-nums">{updatedOn.slice(5)}</span>
			{/if}
		</div>
		{#if latestUpdate}
			<p class="truncate text-tiny text-muted-foreground" title={latestUpdate}>{latestUpdate}</p>
		{/if}
	</div>
{/snippet}

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

{#snippet taskUpdateCell({
	row
}: {
	row: {
		readonly latest_update?: string | null;
		readonly last_updated_on?: string | null;
	};
})}
	{#if row.latest_update}
		<div class="flex min-w-0 items-center gap-1.5" title={row.latest_update}>
			{#if row.last_updated_on}
				<span class="shrink-0 font-mono text-tiny tabular-nums text-muted-foreground">
					{row.last_updated_on.slice(5)}
				</span>
			{/if}
			<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{row.latest_update}</span>
		</div>
	{:else}
		<span class="text-micro text-muted-foreground">—</span>
	{/if}
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
				page_size={100}
				row_class={(r) => (r.status === 'blocked' ? 'bg-tone-destructive-bg/20' : undefined)}
				toolbar={{
					title: t('programme.tasks_title'),
					trailing: tasksViewToggle,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
				columns={[
					{ field: 'task_code', width: 88 },
					{ field: 'title', width: 250, cell: taskTitleCell },
					{ field: 'subcontractor_id', width: 148 },
					{ field: 'trade_specialty', width: 108 },
					{ field: 'zone', width: 88, hide: 'narrow' },
					{ field: 'status', width: 96 },
					{ field: 'progress_pct', width: 84, align: 'end', cell: taskProgressCell },
					{ field: 'schedule_range', width: 148, hide: 'narrow' },
					{ field: 'latest_update', width: 240, cell: taskUpdateCell }
				]}
			/>
		{:else if tasksView === 'board'}
			<Board
				{ctx}
				of="tasks"
				key={`project:tasks:board:${id}`}
				where={{ project_id: { eq: id } }}
				order_by={{ last_updated_on: 'desc' }}
				by="status"
				lanes={['todo', 'in_progress', 'blocked', 'done']}
				columns={4}
				page_size={50}
				card={taskBoardCard}
				toolbar={{
					title: t('programme.tasks_title'),
					trailing: tasksViewToggle,
					select: false,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
			/>
		{:else if tasksQuery?.loading && !tasksQuery.current}
			<Bound size="content" inset>
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_programme')}</span>
				</Inline>
			</Bound>
		{:else if tasksQuery?.error}
			<Bound size="content" inset>
				<Alert.Root variant="destructive">
					<Alert.Title>{tasksQuery.error.message}</Alert.Title>
				</Alert.Root>
			</Bound>
		{:else}
			<CustomView
				{ctx}
				model="tasks"
				of={tasksQuery?.current?.tasks.rows ?? []}
				fields={['task_code', 'title', 'trade_specialty', 'zone', 'status', 'priority']}
				key={`project:timeline:${id}`}
				empty={false}
				toolbar={{
					title: t('programme.tasks_title'),
					trailing: tasksViewToggle,
					context: { project_id: id },
					new: ctx.catalog?.tasks?.create ? () => (createSheet = { kind: 'task' }) : false
				}}
			>
				{#snippet children(shownTasks)}
					<Scroll name={t('programme.tasks_title')} size="fill">
						<div class="px-3 pb-3">
							<ProjectTimeline
								{ctx}
								projectRange={record.schedule_range}
								tasks={shownTasks}
								today={day.today}
								onInspectBim={(expressIds, label) => {
									timelineBimHighlight = { label, expressIds: [...expressIds] };
								}}
							/>
						</div>
					</Scroll>
				{/snippet}
			</CustomView>
		{/if}
	{/if}
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

		{#if issuesQuery?.error}
			<Alert.Root variant="destructive">
				<Alert.Title>{issuesQuery.error.message}</Alert.Title>
			</Alert.Root>
		{/if}

		{#if timelineBimHighlight}
			<Surface tone="subtle" padding="xs" radius="control">
				<Inline align="center" justify="between" gap="sm">
					<span class="text-micro text-foreground">
						{t('bim.showing_4d_slice', { date: timelineBimHighlight.label })}
					</span>
					<Button
						variant="ghost"
						class="h-6 px-2 text-micro"
						onclick={() => (timelineBimHighlight = null)}
					>
						{t('component.clear_filter')}
					</Button>
				</Inline>
			</Surface>
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
					translateKey={rawT}
					src={activeIfcSrc}
					alt={projectBimFile.name}
					{markerGroups}
					issues={bimIssues}
					{focusIssue}
					{...ctx.catalog?.issues?.create !== undefined
						? { onTagIssue: handleTagIssueFromBim }
						: {}}
					onOpenIssue={(issueId) => open_record('issues', issueId)}
					{...canUpdateProject ? { onReplaceModel: () => bimUploadInput?.click() } : {}}
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
								values: { project_id: id }
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

{#snippet bimCostingTab()}
	{#if id && record}
		<Scroll name={t('bim_costing.estimates_title')} size="fill" inset>
			<Stack gap="md">
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

				{#if estimateQuery?.loading && !estimateQuery.current}
					<Inline gap="sm" align="center" aria-busy="true">
						<Spinner />
						<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
					</Inline>
				{:else if estimateQuery?.error}
					<Alert.Root variant="destructive">
						<Alert.Title>{estimateQuery.error.message}</Alert.Title>
					</Alert.Root>
				{:else if singleEstimate}
					{@const est = singleEstimate}
					{@const isVoidOrDirty = est.status === 'void' || record.bim_costing_dirty}
					{#if isVoidOrDirty}
						<Alert.Root variant="destructive">
							<Alert.Title>{t('bim_costing.void_banner_title')}</Alert.Title>
							<Alert.Description>
								<Cluster align="center" justify="between" gap="sm">
									<span>{t('bim_costing.void_banner_desc')}</span>
									{#if canAnalyzeBim && projectBimFile}
										<Button
											variant="brand"
											disabled={bimStreaming || bimAnalyze.pending}
											onclick={triggerProjectIfcTakeoff}
										>
											<Icon name="lucide:scan-line" class="size-3.5" />
											{t('bim_costing.run_pipeline')}
										</Button>
									{/if}
								</Cluster>
							</Alert.Description>
						</Alert.Root>
					{/if}
					<Surface tone="card" padding="md" radius="control">
						<Stack gap="md" divided>
							<Cluster align="center" justify="between" gap="sm">
								<Inline gap="sm" align="center">
									<span class="text-label">{est.title}</span>
									<Badge variant={est.status === 'void' ? 'destructive' : 'outline'}>
										{enum_text(est.status, { t: rawT, model: 'cost_estimates', field: 'status' })}
									</Badge>
								</Inline>
								<Cluster gap="xs">
									{#if canAnalyzeBim && (est.status === 'draft' || est.status === 'void') && projectBimFile}
										<Button
											variant={isVoidOrDirty ? 'brand' : 'outline'}
											disabled={bimStreaming || bimAnalyze.pending}
											onclick={triggerProjectIfcTakeoff}
										>
											<Icon name="lucide:scan-line" class="size-3.5" />
											{t('bim_costing.reanalyze_bim')}
										</Button>
									{/if}
									{#if canAnalyzeBim && (est.status === 'draft' || est.status === 'void')}
										<Button
											variant="ghost"
											disabled={bimStreaming || bimAnalyze.pending}
											onclick={() => localIfcInput?.click()}
										>
											<Icon name="lucide:upload" class="size-3.5" />
											{t('bim_costing.scan_local_ifc')}
										</Button>
									{/if}
									<Button variant="secondary" onclick={() => open_record('cost_estimates', est.id)}>
										<Icon name="lucide:pencil" class="size-3.5" />
										{t('bim_costing.open_estimate')}
									</Button>
								</Cluster>
							</Cluster>

							<Grid minimum="card" gap="md">
								<Stack gap="xs">
									<span class="text-meta">{t('bim_costing.coverage')}</span>
									<Inline gap="xs" align="center">
										<span class="text-label tabular-nums">
											{`${est.classified_asset_count} / ${est.bim_asset_count}`}
										</span>
										{#if est.unmatched_asset_count > 0}
											<Badge variant="warning">
												{t('bim_costing.unmatched_badge', { count: est.unmatched_asset_count })}
											</Badge>
										{/if}
									</Inline>
								</Stack>
								<Stack gap="xs">
									<span class="text-meta">{t('bim_costing.bim_subtotal')}</span>
									<span class="text-label tabular-nums">
										<Show {ctx} kind={money} value={est.bim_subtotal} row={est} />
									</span>
								</Stack>
								<Stack gap="xs">
									<span class="text-meta"
										>{t('bim_costing.contingency')} ({est.contingency_pct}%)</span
									>
									<span class="text-label tabular-nums">
										<Show {ctx} kind={money} value={est.contingency_amount} row={est} />
									</span>
								</Stack>
								<Stack gap="xs">
									<span class="text-meta">{t('bim_costing.total_estimate')}</span>
									<span class="text-sm font-medium tabular-nums text-primary">
										<Show {ctx} kind={money} value={est.total_estimate} row={est} />
									</span>
								</Stack>
							</Grid>
						</Stack>
					</Surface>

					<Surface tone="card" padding="md" radius="control">
						<BimTakeoffRenderer
							{ctx}
							view={{
								mode: 'show',
								name: 'bim_takeoff',
								value: est.bim_assets ?? null
							}}
						/>
					</Surface>
				{:else}
					<EmptyState
						variant="card"
						icon="file"
						title={t('bim_costing.estimates_title')}
						hint={t('bim_costing.empty_takeoff')}
					>
						{#if canAnalyzeBim}
							<Cluster gap="xs">
								{#if projectBimFile}
									<Button
										variant="brand"
										disabled={bimStreaming || bimAnalyze.pending}
										onclick={triggerProjectIfcTakeoff}
									>
										<Icon name="lucide:scan-line" class="size-3.5" />
										{t('bim_costing.run_pipeline')}
									</Button>
								{/if}
								<Button
									variant="outline"
									disabled={bimStreaming || bimAnalyze.pending}
									onclick={() => localIfcInput?.click()}
								>
									<Icon name="lucide:upload" class="size-3.5" />
									{t('bim_costing.scan_local_ifc')}
								</Button>
							</Cluster>
						{/if}
					</EmptyState>
				{/if}
			</Stack>
		</Scroll>
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
				keep_alive: true,
				body: bimIssuesTab
			},
			{
				name: 'costing',
				title: t('bim_costing.estimates_title'),
				icon: 'lucide:calculator',
				body: bimCostingTab
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
				actions:
					ctx.catalog?.commercial_documents?.create !== undefined
						? [
								{
									icon: 'lucide:file-plus-2',
									name: t('commercial.draft_claim'),
									description: t('commercial.draft_claim_desc'),
									run: () => ctx.run('generate_payment_claim', { project_id: id })
								}
							]
						: [],
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

{#snippet adhocCostsTab()}
	{#if id}
		<Table
			{ctx}
			of="adhoc_costs"
			key={`project:adhoc:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_adhoc'),
				new: ctx.catalog?.adhoc_costs?.create ? () => (createSheet = { kind: 'adhoc_cost' }) : false
			}}
			columns={[
				'cost_number',
				'catalog_item_id',
				'title',
				'category',
				'contact_id',
				'status',
				'qty',
				'unit',
				'unit_rate',
				'amount',
				'incurred_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet cashflowLedgerTab()}
	{#if id && record}
		{#if commercialQuery?.loading && !commercialQuery.current}
			<Bound size="content" inset>
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
				</Inline>
			</Bound>
		{:else}
			<Table
				{ctx}
				of={catalogLedgerRows}
				controlled
				toolbar={{ title: t('commercial.tab_cashflow_ledger') }}
				columns={[
					{ field: 'code', label: t('commercial.col_code') },
					{ field: 'name', label: t('commercial.col_item') },
					{ field: 'source_label', label: t('priced_lines.col_source') },
					{
						field: 'estimated_budget',
						label: t('commercial.col_budget'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'so_value',
						label: t('commercial.col_so'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'po_committed',
						label: t('commercial.col_po'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'delivered_value',
						label: t('commercial.col_delivered'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'invoiced_outflow',
						label: t('commercial.col_invoiced'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'paid_outflow',
						label: t('commercial.col_paid'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					},
					{
						field: 'budget_variance',
						label: t('commercial.col_variance'),
						kind: { kind: 'money', currency: 'currency' },
						align: 'end'
					}
				]}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet commercialTab()}
	<Tabs
		level={2}
		tabs={[
			{
				name: 'ledger',
				title: t('commercial.tab_cashflow_ledger'),
				icon: 'lucide:bar-chart-3',
				body: cashflowLedgerTab
			},
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
				name: 'adhoc',
				title: t('commercial.tab_adhoc'),
				icon: 'lucide:receipt-text',
				body: adhocCostsTab
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
				keep_alive: true,
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

					{#if commercialQuery?.loading && !commercialQuery.current}
						<Inline gap="sm" align="center" aria-busy="true">
							<Spinner />
							<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
						</Inline>
					{:else if commercialQuery?.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{commercialQuery.error.message}</Alert.Title>
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

			<Section
				icon="lucide:file-text"
				name="filed_documents"
				title={t('project_files.register_title')}
			>
				<Table
					{ctx}
					of="project_files"
					key={`project:files:${record.id}`}
					where={{ project_id: { eq: record.id } }}
					order_by={{ updated_at: 'desc' }}
					toolbar={{
						title: false,
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
			</Section>
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
	{:else if createSheet?.kind === 'adhoc_cost' && id}
		<RecordShell
			{ctx}
			of="adhoc_costs"
			mode="create"
			values={{
				project_id: id,
				currency: record?.currency ?? 'SGD'
			}}
			on_done={() => (createSheet = null)}
		/>
	{/if}
</Sheet>
