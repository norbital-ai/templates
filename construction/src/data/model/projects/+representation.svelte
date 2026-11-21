<script lang="ts">
	/**
	 * Main Contractor Project Hub:
	 * - Top summary strip: Programme, Revised Contract Sum, Net Claimable Now, Open Tasks · Issues
	 * - One concern & one scroll owner per tab (no nested vertical scrolls, no duplicate KPIs):
	 *   1. Overview: readable project details, commercial/cashflow KPIs & native `<Chart>` (inflow vs outflow)
	 *   2. BIM & Issues: 3D IFC viewer + single scoped Issues `<Table>` with Focus-in-3D row action
	 *   3. BIM & Drawings: `project_files` register with revision trails
	 *   4. Schedule & Tasks: same-model view switcher (`Timeline` | `Table` | `Board`) for `tasks`
	 *   5. Site Progress: append-only `progress_updates` diary
	 *   6. Commercial: native level-2 `Tabs` for BOQ, Quotes, Changes / VOs, and Claims & Cashflow
	 *   7. Site Comms: synced `project_messages` feed with Sync & Extract actions
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
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
		Section,
		Sheet,
		Show,
		Table,
		Tabs,
		open_record,
		type RecordView
	} from '@norbital-ai/ui';
	import { Bound, Column, Grid, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import {
		computeProjectCashflow,
		computeProjectValuation,
		toNumber
	} from '../../../lib/claims.js';
	import ProjectTimeline from '../../../lib/ProjectTimeline.svelte';
	import RecordForm from '../../../lib/record-form.svelte';
	import type {
		IFCSelectedElement,
		IFCViewerIssueSummary,
		IFCViewerMarkerGroup
	} from '../../../lib/ifc-viewer/ifc_viewer.types.js';

	let { view, ctx }: { view: RecordView<'projects'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	const money = { kind: 'money', currency: 'currency' } as const;

	// Scoped live queries over full project rows (never capped to arbitrary small pages)
	const filesQuery = $derived(
		record &&
			ctx.query({
				project_files: {
					where: {
						project_id: { eq: record.id },
						status: { in: ['draft', 'in_review', 'issued'] }
					},
					fields: ['title', 'document_number', 'kind', 'file', 'current_version'],
					order_by: { updated_at: 'desc' }
				}
			})
	);

	const issuesQuery = $derived(
		record &&
			ctx.query({
				issues: {
					where: { project_id: { eq: record.id } },
					fields: ['issue_number', 'title', 'severity', 'status', 'bim_pin', 'photos'],
					order_by: { updated_at: 'desc' }
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
						'title',
						'is_milestone',
						'trade',
						'status',
						'priority',
						'progress_pct',
						'schedule_range',
						'bim_express_ids'
					],
					order_by: { task_code: 'asc' }
				},
				change_orders: {
					where: { project_id: { eq: record.id } },
					fields: [
						'change_number',
						'title',
						'status',
						'cost_impact',
						'schedule_impact_days',
						'effective_date'
					],
					order_by: { effective_date: 'asc' }
				},
				progress_updates: {
					where: { project_id: { eq: record.id } },
					fields: ['title', 'update_date', 'category', 'reported_progress_pct'],
					order_by: { update_date: 'desc' }
				}
			})
	);

	const commercialQuery = $derived(
		record &&
			ctx.query({
				cost_items: {
					where: { project_id: { eq: record.id } },
					fields: [
						'item_code',
						'description',
						'cost_group',
						'contract_amount',
						'progress_pct',
						'claimable_amount',
						'retention_exempt'
					],
					order_by: { item_code: 'asc' }
				},
				quotes: {
					where: { project_id: { eq: record.id } },
					fields: ['quote_number', 'direction', 'status', 'subtotal', 'total_amount'],
					order_by: { updated_at: 'desc' }
				},
				payment_claims: {
					where: { project_id: { eq: record.id } },
					fields: [
						'claim_number',
						'direction',
						'status',
						'claimed_amount',
						'certified_amount',
						'valuation_date',
						'due_date',
						'paid_date'
					],
					order_by: { created_at: 'asc' }
				}
			})
	);

	// IFC model selection from project_files
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

	// BIM tagged issues & severity marker groups (read directly from co-located bim_pin)
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
	/** Same-model view switcher for `tasks` (Timeline | Table | Board). */
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
			groups.push({ label: t('bim.legend_critical'), color: '#dc2626', expressIds: critical });
		if (high.length > 0)
			groups.push({ label: t('bim.legend_high'), color: '#ea580c', expressIds: high });
		if (other.length > 0)
			groups.push({ label: t('bim.legend_medium_low'), color: '#eab308', expressIds: other });
		if (timelineBimHighlight && timelineBimHighlight.expressIds.length > 0) {
			groups.push({
				label: t('bim.legend_4d_active', { date: timelineBimHighlight.label }),
				color: '#2563eb',
				expressIds: timelineBimHighlight.expressIds
			});
		}
		return groups;
	});

	// Native Sheet create flows preserving parent project_id & optional BIM pin prefill
	type CreateSheet =
		| null
		| { kind: 'issue'; values: Record<string, unknown> }
		| { kind: 'file' }
		| { kind: 'task' }
		| { kind: 'update' }
		| { kind: 'cost_item' }
		| { kind: 'quote' }
		| { kind: 'change' }
		| { kind: 'claim' };

	let createSheet = $state<CreateSheet>(null);

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

	const valuation = $derived(
		record
			? computeProjectValuation({
					contract_value: record.contract_value,
					retention_rate: record.retention_rate,
					retention_cap_rate: record.retention_cap_rate,
					tax_rate: record.tax_rate,
					cost_items: commercialQuery?.current?.cost_items.rows ?? [],
					change_orders: programmeQuery?.current?.change_orders.rows ?? [],
					quotes: commercialQuery?.current?.quotes.rows ?? [],
					payment_claims: commercialQuery?.current?.payment_claims.rows ?? []
				})
			: null
	);

	const cashflow = $derived(
		computeProjectCashflow(commercialQuery?.current?.payment_claims.rows ?? [], day.today)
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
</script>

{#snippet summary()}
	{#if record}
		<Grid minimum="compact" class="border-b border-border pb-4 text-sm">
			<Stack gap="xs">
				<p class="text-meta">{t('component.programme')}</p>
				<p class="font-medium">
					{#if record.schedule_range}
						<Show {ctx} kind={{ kind: 'period', of: 'date' }} value={record.schedule_range} />
					{:else}
						{t('component.not_set')}
					{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('commercial.revised_contract_sum')}</p>
				<p class="font-medium tabular-nums">
					{#if valuation}
						<Show
							{ctx}
							kind={money}
							value={valuation.revised_contract_sum}
							row={{ currency: record.currency }}
						/>
					{:else if record.contract_value != null}
						<Show {ctx} kind={money} value={record.contract_value} row={record} />
					{:else}
						{t('component.not_set')}
					{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('commercial.net_claimable_now')}</p>
				<p class="font-medium tabular-nums">
					{#if valuation}
						<Show
							{ctx}
							kind={money}
							value={valuation.net_claimable_now}
							row={{ currency: record.currency }}
						/>
					{:else}
						{t('component.no_value')}
					{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.open_tasks_issues')}</p>
				<p class="font-medium tabular-nums">
					{t('component.tasks_issues_pair', {
						tasks: record.open_task_count ?? 0,
						issues: record.open_issue_count ?? 0
					})}
				</p>
			</Stack>
		</Grid>
	{/if}
{/snippet}

{#snippet projectSections(includeSchedule: boolean)}
	<Section icon="lucide:building-2" first name="project" title={t('section.project')}>
		<Grid minimum="compact">
			<Field {ctx} name="project_name" />
			<Field {ctx} name="project_number" />
			<Field {ctx} name="client" />
			<Field {ctx} name="main_contractor" />
			<Field {ctx} name="project_manager" />
			<Field {ctx} name="project_type" />
			<Field {ctx} name="status" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>

	<Section icon="lucide:calculator" name="commercial" title={t('section.schedule_and_value')}>
		<Grid minimum="compact">
			{#if includeSchedule}
				<Field {ctx} name="schedule_range" />
			{/if}
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

{#snippet overviewTab()}
	{#if record && valuation}
		<Bound size="content" inset>
			<Stack gap="lg">
				<!-- Commercial & Cashflow Pulse (zero duplication with top summary strip or form) -->
				<Stack gap="sm" class="rounded-lg border border-border bg-card p-4">
					<Inline align="center" justify="between" gap="sm" class="flex-wrap">
						<p class="text-overline">{t('cashflow.title')}</p>
						<Inline gap="xs" class="flex-wrap">
							{#if toNumber(cashflow.overdue_receivables) > 0}
								<Badge variant="warning">
									{t('cashflow.overdue_in', { amount: cashflow.overdue_receivables })}
								</Badge>
							{/if}
							{#if toNumber(cashflow.overdue_payables) > 0}
								<Badge variant="destructive">
									{t('cashflow.overdue_out', { amount: cashflow.overdue_payables })}
								</Badge>
							{/if}
						</Inline>
					</Inline>

					<Grid minimum="compact" gap="sm" class="border-t border-border pt-3 text-sm">
						<Stack gap="xs">
							<span class="text-meta">{t('commercial.approved_variations')}</span>
							<span class="font-medium tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={valuation.approved_variations}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('commercial.committed_subcon')}</span>
							<span class="font-medium tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={valuation.committed_subcon_cost}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('commercial.projected_margin')}</span>
							<span class="font-medium tabular-nums">
								{t('commercial.margin_pct_value', { pct: valuation.projected_margin_pct })}
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('commercial.gross_work_done')}</span>
							<span class="font-medium tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={valuation.gross_work_done}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('cashflow.received_inflow')}</span>
							<span class="font-medium tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={cashflow.received_inflow}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('cashflow.paid_outflow')}</span>
							<span class="font-medium tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={cashflow.paid_outflow}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('cashflow.net_realized')}</span>
							<span class="font-semibold tabular-nums">
								<Show
									{ctx}
									kind={money}
									value={cashflow.net_realized_cashflow}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('cashflow.net_projected')}</span>
							<span class="font-semibold tabular-nums text-primary">
								<Show
									{ctx}
									kind={money}
									value={cashflow.net_projected_cashflow}
									row={{ currency: record.currency }}
								/>
							</span>
						</Stack>
					</Grid>

					{#if cashflow.months.length > 0}
						<div class="min-h-80 border-t border-border pt-3">
							<Chart
								{ctx}
								of={cashflow.months}
								x="month"
								y={['inflow', 'outflow']}
								kind="bar"
								title={t('cashflow.monthly_chart')}
							/>
						</div>
					{/if}
				</Stack>

				<!-- Readable Project Details in view mode (omits schedule_range shown in top summary) -->
				<Form {ctx} of="projects" mode="view" id={record.id} {record} size="content">
					{@render projectSections(false)}
				</Form>
			</Stack>
		</Bound>
	{/if}
{/snippet}

{#snippet bimViewerPane()}
	<Stack gap="sm" size="fill">
		<Inline align="center" justify="between" gap="sm" class="flex-wrap">
			<h3 class="text-heading">{t('component.coordination_model')}</h3>
			{#if ifcFiles.length > 1}
				<Inline gap="xs" class="flex-wrap">
					{#each ifcFiles as f (f.id)}
						<Button
							variant={activeIfc?.id === f.id ? 'secondary' : 'outline'}
							onclick={() => (selectedIfcId = f.id)}
						>
							{`${f.title} (${f.current_version})`}
						</Button>
					{/each}
				</Inline>
			{/if}
		</Inline>

		{#if timelineBimHighlight}
			<Inline
				align="center"
				justify="between"
				gap="sm"
				class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
			>
				<span>{t('bim.showing_4d_slice', { date: timelineBimHighlight.label })}</span>
				<Button variant="ghost" onclick={() => (timelineBimHighlight = null)}>
					{t('component.clear_filter')}
				</Button>
			</Inline>
		{/if}

		{#if activeIfc && viewer && activeIfcSrc}
			<Bound size="fill" clip class="relative rounded-md border border-border bg-muted/30">
				{#await viewer}
					<Inline align="center" justify="center" size="fill" class="text-sm text-muted-foreground">
						{t('component.loading_viewer')}
					</Inline>
				{:then mod}
					<mod.default
						t={ctx.t}
						src={activeIfcSrc}
						alt={activeIfc.title}
						{markerGroups}
						issues={bimIssues}
						{focusIssue}
						onTagIssue={handleTagIssueFromBim}
						onOpenIssue={(issueId) => open_record('issues', issueId)}
					/>
				{:catch error}
					<Inline align="center" justify="center" size="fill" class="text-sm text-destructive">
						{String(error)}
					</Inline>
				{/await}
			</Bound>
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
			toolbar={{
				title: t('component.issues_register'),
				new: () =>
					(createSheet = {
						kind: 'issue',
						values: { project_id: id, ...(activeIfc ? { bim_file_id: activeIfc.id } : {}) }
					})
			}}
			actions={[
				{
					label: t('bim.focus_in_3d'),
					run: (row) => {
						const match = bimIssueById.get(String(row.id));
						if (match) focusIssue = { ...match };
					}
				}
			]}
			columns={['issue_number', 'title', 'severity', 'status', 'zone', 'bim_pin']}
		/>
	{/if}
{/snippet}

{#snippet bimTab()}
	<Bound size="fill" inset>
		<Split ratio="wide" collapse="stack" start={bimViewerPane} end={bimIssuesTable} />
	</Bound>
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
				new: () => (createSheet = { kind: 'file' })
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

{#snippet scheduleTab()}
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
					new: () => (createSheet = { kind: 'task' })
				}}
				columns={[
					'task_code',
					'title',
					'is_milestone',
					'zone',
					'trade',
					'status',
					'progress_pct',
					'schedule_range'
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
				card={['title', 'trade', 'priority', 'progress_pct']}
				toolbar={{
					title: t('programme.tasks_title'),
					controls: tasksControls,
					new: () => (createSheet = { kind: 'task' })
				}}
			/>
		{:else}
			<CustomView
				{ctx}
				model="tasks"
				of={programmeQuery?.current?.tasks.rows ?? []}
				fields={['task_code', 'title', 'trade', 'status', 'priority']}
				key={`project:timeline:${id}`}
				empty={false}
				toolbar={{
					title: t('programme.tasks_title'),
					controls: tasksControls,
					new: () => (createSheet = { kind: 'task' })
				}}
			>
				{#snippet children(shownTasks)}
					<Bound size="content" inset>
						<ProjectTimeline
							{ctx}
							projectRange={record.schedule_range}
							tasks={shownTasks}
							changes={programmeQuery?.current?.change_orders.rows ?? []}
							updates={programmeQuery?.current?.progress_updates.rows ?? []}
							today={day.today}
							onInspectBim={(expressIds, label) => {
								timelineBimHighlight = { label, expressIds: [...expressIds] };
							}}
						/>
					</Bound>
				{/snippet}
			</CustomView>
		{/if}
	{/if}
{/snippet}

{#snippet progressTab()}
	{#if id}
		<Table
			{ctx}
			of="progress_updates"
			key={`project:progress:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ update_date: 'desc' }}
			toolbar={{
				title: t('programme.view_progress'),
				new: () => (createSheet = { kind: 'update' })
			}}
			columns={[
				'update_date',
				'title',
				'category',
				'zone',
				'task_id',
				'reported_progress_pct',
				'headcount',
				'reported_by'
			]}
		/>
	{/if}
{/snippet}

{#snippet boqTab()}
	{#if id}
		<Table
			{ctx}
			of="cost_items"
			key={`project:boq:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ item_code: 'asc' }}
			toolbar={{
				title: t('commercial.tab_boq'),
				new: () => (createSheet = { kind: 'cost_item' })
			}}
			columns={[
				'item_code',
				'description',
				'cost_group',
				'claim_basis',
				'contract_amount',
				'progress_pct',
				'claimable_amount'
			]}
		/>
	{/if}
{/snippet}

{#snippet quotesTab()}
	{#if id}
		<Table
			{ctx}
			of="quotes"
			key={`project:quotes:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_quotes'),
				new: () => (createSheet = { kind: 'quote' })
			}}
			columns={[
				'quote_number',
				'title',
				'direction',
				'contact_id',
				'current_revision',
				'status',
				'total_amount',
				'valid_until'
			]}
		/>
	{/if}
{/snippet}

{#snippet changesTab()}
	{#if id}
		<Table
			{ctx}
			of="change_orders"
			key={`project:changes:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ created_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_changes'),
				new: () => (createSheet = { kind: 'change' })
			}}
			columns={[
				'change_number',
				'title',
				'change_type',
				'status',
				'cost_impact',
				'schedule_impact_days',
				'effective_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet claimsTab()}
	{#if id}
		<Table
			{ctx}
			of="payment_claims"
			key={`project:claims:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ valuation_date: 'desc' }}
			toolbar={{
				title: t('commercial.tab_claims'),
				actions: [
					{
						icon: 'lucide:file-plus-2',
						name: t('commercial.draft_claim'),
						description: t('commercial.draft_claim_desc'),
						run: () => ctx.run('generate_payment_claim', { project_id: id })
					}
				],
				new: () => (createSheet = { kind: 'claim' })
			}}
			columns={[
				'claim_number',
				'direction',
				'claim_type',
				'status',
				'claimed_amount',
				'certified_amount',
				'due_date',
				'paid_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet commercialTab()}
	<Tabs
		orientation="vertical"
		tabs={[
			{
				name: 'boq',
				title: t('commercial.tab_boq'),
				icon: 'lucide:calculator',
				body: boqTab
			},
			{
				name: 'quotes',
				title: t('commercial.tab_quotes'),
				icon: 'lucide:file-spreadsheet',
				body: quotesTab
			},
			{
				name: 'changes',
				title: t('commercial.tab_changes'),
				icon: 'lucide:git-pull-request',
				body: changesTab
			},
			{
				name: 'claims',
				title: t('commercial.tab_claims'),
				icon: 'lucide:banknote',
				body: claimsTab
			}
		]}
	/>
{/snippet}

{#snippet commsTab()}
	{#if id}
		<Table
			{ctx}
			of="project_messages"
			key={`project:messages:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ occurred_at: 'desc' }}
			toolbar={{
				title: t('project.tab_comms'),
				actions: [
					{
						icon: 'lucide:refresh-cw',
						name: t('messages.action_sync'),
						run: () => ctx.run('sync_messages', {})
					},
					{
						icon: 'lucide:wand-sparkles',
						name: t('messages.action_extract'),
						run: () => ctx.run('extract_project_updates', { project_id: id })
					}
				]
			}}
			columns={[
				'occurred_at',
				'transport',
				'sender_name',
				'subject',
				'classification',
				'extraction_status',
				'extraction_summary'
			]}
		/>
	{/if}
{/snippet}

{#if view.mode === 'view' && record}
	<RecordShell
		{ctx}
		of="projects"
		mode="view"
		id={record.id}
		subtitle={['project_number', 'client', 'status']}
	>
		<Stack gap="md" size="fill">
			{@render summary()}
			<Tabs
				tabs={[
					{
						name: 'overview',
						title: t('project.tab_overview'),
						icon: 'lucide:layout-dashboard',
						body: overviewTab
					},
					{
						name: 'bim',
						title: t('project.tab_bim'),
						icon: 'lucide:box',
						body: bimTab
					},
					{
						name: 'files',
						title: t('project_files.register_title'),
						icon: 'lucide:file-box',
						body: filesTab
					},
					{
						name: 'schedule',
						title: t('project.tab_programme'),
						icon: 'lucide:gantt-chart',
						body: scheduleTab
					},
					{
						name: 'progress',
						title: t('programme.view_progress'),
						icon: 'lucide:trending-up',
						body: progressTab
					},
					{
						name: 'commercial',
						title: t('project.tab_commercial'),
						icon: 'lucide:calculator',
						body: commercialTab
					},
					{
						name: 'comms',
						title: t('project.tab_comms'),
						icon: 'lucide:message-square-text',
						body: commsTab
					}
				]}
			/>
		</Stack>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['project_number', 'client', 'status']}>
		{@render projectSections(true)}
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
	{:else if createSheet?.kind === 'update' && id}
		<RecordShell
			{ctx}
			of="progress_updates"
			mode="create"
			values={{ project_id: id }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'cost_item' && id}
		<RecordShell
			{ctx}
			of="cost_items"
			mode="create"
			values={{ project_id: id, currency: record?.currency ?? 'SGD' }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'quote' && id}
		<RecordShell
			{ctx}
			of="quotes"
			mode="create"
			values={{ project_id: id, currency: record?.currency ?? 'SGD' }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'change' && id}
		<RecordShell
			{ctx}
			of="change_orders"
			mode="create"
			values={{ project_id: id, currency: record?.currency ?? 'SGD' }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'claim' && id}
		<RecordShell
			{ctx}
			of="payment_claims"
			mode="create"
			values={{ project_id: id, currency: record?.currency ?? 'SGD' }}
			on_done={() => (createSheet = null)}
		/>
	{/if}
</Sheet>
