<script lang="ts">
	/**
	 * Project Hub → Compliance tab:
	 * 1. `Overview & BIM Lints` — statutory gateway & ISO 19650-2 KPI summary, PDF compliance report
	 *    previewer/exporter, and searchable/filterable CORENET X / BCA / SCDF / PUB / SOP lints table.
	 * 2. `Audits & IMS Register` — BCA CONQUAS, CORENET X, ISO 9001, 14001, 45001, and 19650 site
	 *    inspections, NCRs, safety, and environmental compliance records.
	 */
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		Icon,
		Progress,
		Surface,
		Table,
		Tabs,
		enum_text
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { classifyFindingResolution } from '../../../services/bim/remediation.js';
	import ReportPreviewDialog from '../../../services/reports/ReportPreviewDialog.svelte';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';

	let {
		ctx,
		record,
		today,
		onCreateComplianceRecord,
		onInspectBim
	}: {
		ctx: PageContext;
		record: Row<'projects'>;
		today: string;
		onCreateComplianceRecord: () => void;
		onInspectBim?: (expressIds: readonly number[], label: string) => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const canCreateRecord = $derived(ctx.catalog?.compliance_records?.create !== undefined);
	let reportPreviewOpen = $state(false);
	let authorityFilter = $state<string>('all');

	const summaryQuery = $derived(
		ctx.query({
			compliance_records: {
				where: { project_id: { eq: record.id } },
				fields: ['status'],
				limit: 500
			},
			sop_rules: {
				where: { active: { eq: true } },
				fields: ['code', 'metric', 'threshold_num', 'ifc_classes'],
				limit: 200
			}
		})
	);

	const compliance = $derived(record.bim_compliance ?? null);
	const ruleByCode = $derived(
		new Map((summaryQuery.current?.sop_rules.rows ?? []).map((r) => [r.code, r] as const))
	);
	const auditRows = $derived(summaryQuery.current?.compliance_records.rows ?? []);
	const openAudits = $derived(
		auditRows.filter((r) => r.status === 'open' || r.status === 'in_progress').length
	);
	const closedAudits = $derived(auditRows.length - openAudits);

	function authorityLabel(auth: string): string {
		switch (auth) {
			case 'corenet_x':
				return 'CORENET X';
			case 'bca':
				return 'BCA';
			case 'scdf':
				return 'SCDF';
			case 'pub':
				return 'PUB';
			case 'ura':
				return 'URA';
			case 'company_sop':
				return 'SOP';
			default:
				return auth.toUpperCase();
		}
	}

	function statusBadgeVariant(
		statusStr: string
	): 'success' | 'warning' | 'destructive' | 'outline' {
		if (statusStr === 'pass') return 'success';
		if (statusStr === 'warning') return 'warning';
		if (statusStr === 'fail') return 'destructive';
		return 'outline';
	}

	const authorities = $derived([
		'all',
		...[...new Set((compliance?.findings ?? []).map((f) => f.authority))].sort()
	]);
	const authorityOptions = $derived(
		authorities.map((auth) => ({
			value: auth,
			label: auth === 'all' ? t('timeline.filter_all') : authorityLabel(auth)
		}))
	);

	const findingsWithResolution = $derived(
		(compliance?.findings ?? [])
			.filter((f) => authorityFilter === 'all' || f.authority === authorityFilter)
			.map((finding) => ({
				finding,
				resolution: classifyFindingResolution(finding, ruleByCode.get(finding.rule_code) ?? null)
			}))
	);

	type FindingRow = {
		readonly id: string;
		readonly finding: (typeof findingsWithResolution)[number]['finding'];
		readonly resolution: (typeof findingsWithResolution)[number]['resolution'];
		readonly status: string;
		readonly authority: string;
		readonly rule_code: string;
		readonly rule_name: string;
		readonly actual: string;
		readonly expected: string;
		readonly resolution_label: string;
		readonly affected_count: number;
	};

	const findingTableRows = $derived<readonly FindingRow[]>(
		findingsWithResolution.map(({ finding, resolution }) => ({
			id: finding.rule_code,
			finding,
			resolution,
			status: finding.status.toUpperCase(),
			authority: authorityLabel(finding.authority),
			rule_code: finding.rule_code,
			rule_name: finding.rule_name,
			actual: finding.actual,
			expected: finding.expected,
			resolution_label:
				finding.status === 'pass'
					? t('bim_compliance.already_compliant')
					: resolution.kind === 'cleanup'
						? t('bim_compliance.resolved_by_cleanup')
						: resolution.kind === 'classification'
							? t('bim_compliance.resolved_by_classification')
							: t('bim_compliance.requires_bim_revision'),
			affected_count: finding.affected_count
		}))
	);
</script>

{#snippet authorityControls()}
	<SegmentedToggle
		options={authorityOptions}
		value={authorityFilter}
		onChange={(next) => (authorityFilter = next)}
		label={t('bim_compliance.title')}
		control={{
			id: 'construction:project-compliance-authority',
			label: t('bim_compliance.title')
		}}
	/>
{/snippet}

{#snippet statusCell({ row }: { row: FindingRow })}
	<Badge variant={statusBadgeVariant(row.finding.status)} class="text-tiny">{row.status}</Badge>
{/snippet}

{#snippet ruleCell({ row }: { row: FindingRow })}
	{@const f = row.finding}
	<div
		class="flex min-w-0 items-center gap-1.5"
		title={[f.rule_name, f.clause_ref ?? '', f.remediation ?? ''].filter(Boolean).join(' · ')}
	>
		<span class="min-w-0 truncate text-label text-foreground">{f.rule_name}</span>
		{#if f.clause_ref}
			<span class="shrink-0 font-mono text-tiny text-muted-foreground">{f.clause_ref}</span>
		{/if}
	</div>
{/snippet}

{#snippet resolutionCell({ row }: { row: FindingRow })}
	{@const f = row.finding}
	{#if f.status === 'pass'}
		<span class="text-micro text-tone-success-text">{row.resolution_label}</span>
	{:else if row.resolution.kind === 'cleanup' || row.resolution.kind === 'classification'}
		<Badge variant="success" class="text-tiny">{row.resolution_label}</Badge>
	{:else}
		<Badge variant="destructive" class="text-tiny">{row.resolution_label}</Badge>
	{/if}
{/snippet}

{#snippet inspect3dCell({ row }: { row: FindingRow })}
	{@const f = row.finding}
	{#if f.status !== 'pass' && onInspectBim && f.sample_express_ids?.length}
		<Button
			variant="outline"
			onclick={() => onInspectBim(f.sample_express_ids ?? [], `${f.rule_code} · ${f.rule_name}`)}
		>
			<Icon name="lucide:box" class="size-3.5" />
			{f.affected_count}
		</Button>
	{:else}
		<span class="text-micro text-muted-foreground">{f.affected_count}</span>
	{/if}
{/snippet}

{#snippet overviewTab()}
	<Bound size="fill" inset>
		<Stack gap="sm" size="fill">
			<Surface tone="card" padding="sm" radius="control" class="shrink-0">
				<Stack gap="sm" divided>
					<Cluster align="center" justify="between" gap="sm">
						<Cluster align="center" gap="xs">
							<Icon name="lucide:shield-check" class="size-4 text-muted-foreground" />
							<span class="text-label">{t('project.tab_compliance')}</span>
							{#if record.submission_gateway}
								<Badge variant="outline">
									{enum_text(record.submission_gateway, {
										t: rawT,
										model: 'projects',
										field: 'submission_gateway'
									})}
								</Badge>
							{/if}
							{#if record.bca_project_ref}
								<Badge variant="outline" class="font-mono text-tiny">
									{record.bca_project_ref}
								</Badge>
							{/if}
						</Cluster>
						<Button variant="brand" onclick={() => (reportPreviewOpen = true)}>
							<Icon name="lucide:file-text" class="size-3.5" />
							{t('reports.preview_export')}
						</Button>
					</Cluster>

					<Grid minimum="compact" gap="sm">
						<Stack gap="none">
							<span class="text-micro text-muted-foreground">{t('bim_compliance.score_label')}</span
							>
							{#if compliance}
								<Inline gap="xs" align="center">
									<Progress value={compliance.score_pct} max={100} class="h-1.5 flex-1" />
									<span class="font-mono text-xs tabular-nums">{`${compliance.score_pct}%`}</span>
								</Inline>
							{:else}
								<span class="text-label">{t('component.no_value')}</span>
							{/if}
						</Stack>
						<Stack gap="none">
							<span class="text-micro text-muted-foreground">{t('bim_compliance.failures')}</span>
							<span class="text-label tabular-nums">
								{compliance
									? `${compliance.fail_count} / ${compliance.warn_count}`
									: t('component.no_value')}
							</span>
						</Stack>
						<Stack gap="none">
							<span class="text-micro text-muted-foreground">{t('compliance.audits_summary')}</span>
							<span class="text-label tabular-nums">
								{t('compliance.open_closed_pair', { open: openAudits, closed: closedAudits })}
							</span>
						</Stack>
					</Grid>

					{#if record.qualified_person || record.bim_manager || record.bep_version || record.conquas_band_target}
						<Grid minimum="compact" gap="sm">
							{#if record.qualified_person}
								<Stack gap="none">
									<span class="text-micro text-muted-foreground"
										>{t('models.projects.fields.qualified_person')}</span
									>
									<span class="truncate text-xs text-foreground">{record.qualified_person}</span>
								</Stack>
							{/if}
							{#if record.bim_manager}
								<Stack gap="none">
									<span class="text-micro text-muted-foreground"
										>{t('models.projects.fields.bim_manager')}</span
									>
									<span class="truncate text-xs text-foreground">{record.bim_manager}</span>
								</Stack>
							{/if}
							{#if record.bep_version}
								<Stack gap="none">
									<span class="text-micro text-muted-foreground"
										>{t('models.projects.fields.bep_version')}</span
									>
									<span class="truncate text-xs text-foreground">{record.bep_version}</span>
								</Stack>
							{/if}
							{#if record.conquas_band_target}
								<Stack gap="none">
									<span class="text-micro text-muted-foreground"
										>{t('models.projects.fields.conquas_band_target')}</span
									>
									<span class="truncate text-xs text-foreground">{record.conquas_band_target}</span>
								</Stack>
							{/if}
						</Grid>
					{/if}
				</Stack>
			</Surface>

			{#if compliance && compliance.findings.length > 0}
				<Bound size="fill" min_height="12rem">
					<Table
						{ctx}
						of={findingTableRows}
						key={`project:compliance-lints:${record.id}`}
						layout="grid"
						row_class={(row) => (row.finding.status === 'pass' ? undefined : 'bg-muted/15')}
						toolbar={{
							title: t('bim_compliance.title'),
							controls: authorityControls,
							export: false,
							select: false,
							new: false
						}}
						columns={[
							{
								field: 'status',
								label: t('bim_compliance.col_status'),
								width: 80,
								cell: statusCell
							},
							{ field: 'authority', label: t('models.sop_rules.fields.authority'), width: 88 },
							{ field: 'rule_code', label: t('models.sop_rules.fields.code'), width: 120 },
							{
								field: 'rule_name',
								label: t('bim_compliance.col_rule'),
								width: 230,
								cell: ruleCell
							},
							{ field: 'actual', label: t('bim_compliance.col_current'), width: 148 },
							{ field: 'expected', label: t('bim_compliance.expected'), width: 120 },
							{
								field: 'resolution_label',
								label: t('bim_compliance.col_resolution'),
								width: 156,
								cell: resolutionCell
							},
							{
								field: 'affected_count',
								label: t('bim_review.inspect_3d'),
								width: 72,
								align: 'end',
								cell: inspect3dCell
							}
						]}
					/>
				</Bound>
			{:else}
				<EmptyState
					variant="card"
					title={t('compliance.no_bim_lints')}
					hint={t('compliance.no_bim_lints_hint')}
				/>
			{/if}
		</Stack>
	</Bound>
{/snippet}

{#snippet registerTab()}
	<Table
		{ctx}
		of="compliance_records"
		key={`project:compliance-records:${record.id}`}
		where={{ project_id: { eq: record.id } }}
		order_by={{ recorded_on: 'desc' }}
		toolbar={{
			title: t('compliance.register_title'),
			description: t('compliance.register_description'),
			new: canCreateRecord ? onCreateComplianceRecord : false
		}}
		columns={[
			'record_code',
			'recorded_on',
			'standard',
			'category',
			'title',
			'severity',
			'status',
			'owner'
		]}
	/>
{/snippet}

<Tabs
	level={2}
	tabs={[
		{
			name: 'overview',
			title: t('compliance.overview_tab'),
			icon: 'lucide:shield-check',
			body: overviewTab
		},
		{
			name: 'register',
			title: t('compliance.register_tab'),
			icon: 'lucide:clipboard-check',
			body: registerTab
		}
	]}
/>

{#if reportPreviewOpen}
	<ReportPreviewDialog
		{ctx}
		projectId={record.id}
		kind="compliance_report"
		{today}
		onClose={() => (reportPreviewOpen = false)}
	/>
{/if}
