<script lang="ts">
	/**
	 * BIM Costing — Step 2 (`review`) inside the tunneled phased workflow:
	 * Scope of Proposed Clean BIM is strictly classification + label/metadata cleanup (no physical
	 * geometry or dimension mutations). Dedicated views separate editable tables from read-only lints:
	 * 1. `Proposed Clean BIM` — full-width table for classification & metadata cleanup review.
	 * 2. `Proposed Item Matrix` — full-width table of newly proposed & project catalog rates.
	 * 3. `Compliance Report` (read-only diagnostic, never styled like an editable form) — clearly
	 *    separates issues resolved by cleanup/classification from issues requiring a BIM model revision.
	 */
	import type { CurrencyCode, FileRef, Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, format, Icon, Progress, Spinner, Table, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Bound, Cluster, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import { Effect, Schema } from 'effect';
	import {
		cleanAndOrganizeIfcStep,
		type BimAssetOverride
	} from '../../../services/bim/organizer.js';
	import { classifyFindingResolution } from '../../../services/bim/remediation.js';
	import { ExtractedBimModelSchema, type BimTakeoffLine } from '../../../services/bim/schema.js';
	import { downloadTextFile, safeFilename } from '../../../services/ui/download.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';
	import { fetchEffect } from '../../../services/viewer/types.js';
	import BimAssetReview from './BimAssetReview.svelte';
	import BimItemMatrixReview from './BimItemMatrixReview.svelte';

	type ReviewView = 'clean_bim' | 'item_matrix' | 'compliance';

	let {
		ctx,
		projectName,
		currency,
		bimFile = null,
		bimTakeoff = null,
		bimSummary = null,
		compliance = null,
		signatures = [],
		bimAssets = [],
		busy = false,
		canAnalyze = false,
		onRerunCompliance,
		onContinueToCosting,
		onInspect3d,
		onPreviewComplianceReport,
		onMutated
	}: {
		ctx: PageContext;
		projectName: string;
		currency: CurrencyCode;
		bimFile?: FileRef | null;
		bimTakeoff?: FileRef | null;
		bimSummary?: Row<'projects'>['bim_summary'];
		compliance?: Row<'projects'>['bim_compliance'];
		signatures?: readonly string[];
		bimAssets?: readonly BimTakeoffLine[];
		busy?: boolean;
		canAnalyze?: boolean;
		onRerunCompliance?: () => void;
		onContinueToCosting?: () => void;
		onInspect3d?: (expressIds: readonly number[], label: string) => void;
		onPreviewComplianceReport?: () => void;
		onMutated?: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);

	let activeView = $state<ReviewView>('clean_bim');
	let authorityFilter = $state<string>('all');
	let exportingIfc = $state(false);

	const sopRulesQuery = $derived(
		ctx.query({
			sop_rules: {
				where: { active: { eq: true } },
				fields: ['code', 'metric', 'threshold_num', 'ifc_classes'],
				limit: 200
			}
		})
	);
	const ruleByCode = $derived(
		new Map((sopRulesQuery.current?.sop_rules.rows ?? []).map((r) => [r.code, r] as const))
	);

	const mappingsQuery = $derived(
		signatures.length > 0
			? ctx.query({
					asset_mappings: {
						where: { signature: { in: [...signatures] } },
						fields: [
							'revision',
							'signature',
							'label',
							'ifc_class',
							'continuity',
							'service',
							'review_status',
							'source'
						],
						item_id: { fields: ['code', 'trade_specialty'] },
						limit: Math.max(signatures.length, 250)
					}
				})
			: null
	);

	const projectMappings = $derived(mappingsQuery?.current?.asset_mappings.rows ?? []);

	const overridesBySignature = $derived.by(() => {
		const map = new Map<string, BimAssetOverride>();
		for (const row of projectMappings) {
			map.set(row.signature, {
				ifc_class: row.ifc_class,
				continuity: row.continuity,
				service: row.service,
				matrix_code: row.item_id?.code ?? null,
				trade_specialty: row.item_id?.trade_specialty ?? null,
				review_status: row.review_status,
				source: row.source
			});
		}
		return map;
	});

	const pendingProposalCount = $derived(projectMappings.filter((r) => r.$approval != null).length);

	const findingsWithResolution = $derived(
		(compliance?.findings ?? []).map((finding) => ({
			finding,
			resolution: classifyFindingResolution(finding, ruleByCode.get(finding.rule_code) ?? null)
		}))
	);
	const nonPassingFindings = $derived(
		findingsWithResolution.filter((entry) => entry.finding.status !== 'pass')
	);
	const resolvedByCleanupCount = $derived(
		nonPassingFindings.filter((e) => !e.resolution.requiresBimRevision).length
	);
	const requiresBimRevisionCount = $derived(
		nonPassingFindings.filter((e) => e.resolution.requiresBimRevision).length
	);

	const authorities = $derived([
		'all',
		...[...new Set((compliance?.findings ?? []).map((f) => f.authority))].sort()
	]);
	const visibleFindings = $derived(
		findingsWithResolution.filter(
			({ finding }) => authorityFilter === 'all' || finding.authority === authorityFilter
		)
	);
	type ComplianceTableRow = {
		readonly id: string;
		readonly finding: (typeof visibleFindings)[number]['finding'];
		readonly resolution: (typeof visibleFindings)[number]['resolution'];
		readonly status: string;
		readonly authority: string;
		readonly rule_code: string;
		readonly rule_name: string;
		readonly actual: string;
		readonly expected: string;
		readonly resolution_label: string;
		readonly affected_count: number;
	};
	const complianceTableRows = $derived<readonly ComplianceTableRow[]>(
		visibleFindings.map(({ finding, resolution }) => ({
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
	const authorityOptions = $derived(
		authorities.map((auth) => ({
			value: auth,
			label: auth === 'all' ? t('timeline.filter_all') : authorityLabel(auth)
		}))
	);

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

	function downloadCleanIfc(): void {
		if (!bimFile || !bimTakeoff || exportingIfc) return;
		exportingIfc = true;
		const ifcUrl = ctx.file_url(bimFile);
		const takeoffUrl = ctx.file_url(bimTakeoff);
		const decodeTakeoff = Schema.decodeUnknownEffect(
			Schema.fromJsonString(ExtractedBimModelSchema)
		);
		fork(
			Effect.all([
				fetchEffect(ifcUrl, 'fetch-ifc-clean').pipe(
					Effect.flatMap((res) => Effect.tryPromise(() => res.text()))
				),
				fetchEffect(takeoffUrl, 'fetch-takeoff-clean').pipe(
					Effect.flatMap((res) => Effect.tryPromise(() => res.text())),
					Effect.flatMap(decodeTakeoff)
				)
			]).pipe(
				Effect.match({
					onFailure: (err) => {
						exportingIfc = false;
						toast.error(err instanceof Error ? err.message : String(err));
					},
					onSuccess: ([rawIfc, extracted]) => {
						const cleaned = cleanAndOrganizeIfcStep(rawIfc, extracted, overridesBySignature);
						downloadTextFile(
							cleaned.ifcText,
							`${safeFilename(projectName)}_Cleaned.ifc`,
							'application/octet-stream'
						);
						toast.success(
							t('bim_step.download_clean_done', {
								tagged: cleaned.stats.total_elements_tagged,
								promoted: cleaned.stats.classes_promoted,
								duplicates: cleaned.stats.duplicates_removed,
								overrides: cleaned.stats.qs_overrides_applied
							})
						);
						exportingIfc = false;
					}
				})
			)
		);
	}

	const viewOptions = $derived([
		{
			value: 'clean_bim' as const,
			label: t('bim_step.tab_clean_bim', { count: signatures.length })
		},
		{
			value: 'item_matrix' as const,
			label:
				pendingProposalCount > 0
					? `${t('bim_review.tab_matrix')} (${pendingProposalCount})`
					: t('bim_review.tab_matrix')
		},
		...(compliance
			? [
					{
						value: 'compliance' as const,
						label: t('bim_review.tab_compliance_issues', {
							count: nonPassingFindings.length,
							pct: compliance.score_pct
						})
					}
				]
			: [])
	]);
</script>

{#snippet authorityControls()}
	<SegmentedToggle
		options={authorityOptions}
		value={authorityFilter}
		onChange={(next) => (authorityFilter = next)}
		label={t('bim_compliance.title')}
		control={{
			id: 'construction:bim-compliance-authority',
			label: t('bim_compliance.title')
		}}
	/>
{/snippet}

{#snippet statusCell({ row }: { row: ComplianceTableRow })}
	<Badge variant={statusBadgeVariant(row.finding.status)} class="text-tiny">
		{row.status}
	</Badge>
{/snippet}

{#snippet ruleCell({ row }: { row: ComplianceTableRow })}
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

{#snippet resolutionCell({ row }: { row: ComplianceTableRow })}
	{@const f = row.finding}
	{#if f.status === 'pass'}
		<span class="text-micro text-tone-success-text">{row.resolution_label}</span>
	{:else if row.resolution.kind === 'cleanup'}
		<Badge variant="success" class="text-tiny">
			<Icon name="lucide:sparkles" class="size-2.5" />
			{row.resolution_label}
		</Badge>
	{:else if row.resolution.kind === 'classification'}
		<Badge variant="success" class="text-tiny">
			<Icon name="lucide:check" class="size-2.5" />
			{row.resolution_label}
		</Badge>
	{:else}
		<Badge variant="destructive" class="text-tiny" title={t('bim_compliance.not_auto_corrected')}>
			<Icon name="lucide:triangle-alert" class="size-2.5" />
			{row.resolution_label}
		</Badge>
	{/if}
{/snippet}

{#snippet inspect3dCell({ row }: { row: ComplianceTableRow })}
	{@const f = row.finding}
	{#if f.status !== 'pass' && onInspect3d && f.sample_express_ids?.length}
		<Button
			variant="outline"
			onclick={() => onInspect3d(f.sample_express_ids ?? [], `${f.rule_code} · ${f.rule_name}`)}
		>
			<Icon name="lucide:box" class="size-3.5" />
			{f.affected_count}
		</Button>
	{:else}
		<span class="text-micro text-muted-foreground">{f.affected_count}</span>
	{/if}
{/snippet}

<Stack gap="md">
	<Surface tone="card" padding="md" radius="control">
		<Stack gap="sm">
			<Cluster align="center" justify="between" gap="sm">
				<Stack gap="xs">
					<span class="text-label">{t('bim_workflow.step2_heading')}</span>
					<span class="text-meta">{t('bim_workflow.step2_desc')}</span>
					{#if bimSummary && ((bimSummary.upgraded_classes ?? 0) > 0 || (bimSummary.propagated_services ?? 0) > 0 || (bimSummary.multi_storey_splits ?? 0) > 0 || (bimSummary.dropped_duplicates ?? 0) > 0)}
						<Inline gap="xs" align="center" class="text-micro text-tone-info-text">
							<Icon name="lucide:sparkles" class="size-3 shrink-0" />
							<span>
								{t('bim_costing.cleanup_summary', {
									upgraded: bimSummary.upgraded_classes ?? 0,
									services: bimSummary.propagated_services ?? 0,
									splits: bimSummary.multi_storey_splits ?? 0,
									duplicates: bimSummary.dropped_duplicates ?? 0
								})}
							</span>
						</Inline>
					{/if}
				</Stack>

				<Cluster gap="xs" align="center">
					{#if bimFile && bimTakeoff}
						<Button variant="outline" disabled={exportingIfc || busy} onclick={downloadCleanIfc}>
							{#if exportingIfc}
								<Spinner class="size-3.5" />
							{:else}
								<Icon name="lucide:download" class="size-3.5" />
							{/if}
							{t('bim_step.download_clean_ifc')}
						</Button>
					{/if}
					{#if onContinueToCosting}
						<Button variant="brand" disabled={busy} onclick={onContinueToCosting}>
							<Icon name="lucide:arrow-right" class="size-3.5" />
							{t('bim_workflow.continue_step3')}
						</Button>
					{/if}
				</Cluster>
			</Cluster>

			<Cluster align="center" justify="between" gap="sm">
				<SegmentedToggle
					options={viewOptions}
					value={activeView}
					onChange={(next) => (activeView = next)}
					label={t('bim_workflow.step2_heading')}
					control={{
						id: 'construction:bim-step2-view',
						label: t('bim_workflow.step2_heading')
					}}
				/>
				{#if compliance && nonPassingFindings.length > 0 && activeView !== 'compliance'}
					<Button variant="ghost" onclick={() => (activeView = 'compliance')}>
						<Icon name="lucide:shield-alert" class="size-3.5 text-tone-warning-text" />
						<span class="text-xs">
							{t('bim_review.lint_revision_callout', {
								revisions: requiresBimRevisionCount,
								cleanup: resolvedByCleanupCount
							})}
						</span>
					</Button>
				{/if}
			</Cluster>
		</Stack>
	</Surface>

	{#if activeView === 'clean_bim'}
		<BimAssetReview
			{ctx}
			{signatures}
			{bimAssets}
			complianceFindings={compliance?.findings ?? []}
			{ruleByCode}
			{...onInspect3d ? { onInspect3d } : {}}
			onReviewProposals={() => (activeView = 'item_matrix')}
			{...onMutated ? { onMutated } : {}}
		/>
	{:else if activeView === 'item_matrix'}
		<BimItemMatrixReview
			{ctx}
			{currency}
			assetLinks={projectMappings}
			{...onMutated ? { onMutated } : {}}
		/>
	{:else if compliance}
		<!-- Read-only compliance & SOP diagnostic report (separate view, zero form chrome) -->
		<Stack gap="md">
			<Surface tone="subtle" padding="md" radius="control">
				<Stack gap="md">
					<Cluster align="center" justify="between" gap="sm">
						<Stack gap="xs">
							<Inline gap="xs" align="center">
								<Icon name="lucide:shield-check" class="size-4 text-muted-foreground" />
								<span class="text-label">{t('bim_compliance.report_heading')}</span>
								<Badge variant="outline" class="text-tiny">
									{t('bim_compliance.readonly_badge')}
								</Badge>
							</Inline>
							<span class="text-meta">
								{t('bim_compliance.resolution_banner', {
									cleanup: resolvedByCleanupCount,
									revisions: requiresBimRevisionCount
								})}
							</span>
						</Stack>
						<Cluster gap="xs" align="center">
							<span class="text-meta">
								{t('bim_compliance.checked_at', {
									when: format({ kind: 'instant' }, compliance.checked_at, { locale: ctx.locale })
								})}
							</span>
							{#if onPreviewComplianceReport}
								<Button variant="outline" onclick={onPreviewComplianceReport}>
									<Icon name="lucide:file-text" class="size-3.5" />
									{t('reports.preview_export')}
								</Button>
							{/if}
							{#if canAnalyze && bimFile && onRerunCompliance}
								<Button variant="outline" disabled={busy} onclick={onRerunCompliance}>
									<Icon name="lucide:refresh-cw" class="size-3.5" />
									{t('bim_compliance.recheck')}
								</Button>
							{/if}
						</Cluster>
					</Cluster>

					<Grid minimum="card" gap="md">
						<Stack gap="xs">
							<span class="text-meta">{t('bim_compliance.score_label')}</span>
							<Inline gap="xs" align="center">
								<Progress value={compliance.score_pct} max={100} class="h-2 flex-1" />
								<span class="font-mono text-xs tabular-nums">{`${compliance.score_pct}%`}</span>
							</Inline>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('bim_compliance.passed')}</span>
							<span class="text-sm tabular-nums text-tone-success-text">
								{`${compliance.pass_count} / ${compliance.total_rules}`}
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('bim_compliance.warnings')}</span>
							<span class="text-sm tabular-nums text-tone-warning-text">
								{compliance.warn_count}
							</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('bim_compliance.failures')}</span>
							<span class="text-sm tabular-nums text-tone-destructive-text">
								{compliance.fail_count}
							</span>
						</Stack>
					</Grid>
				</Stack>
			</Surface>

			<Bound size="viewport">
				<Table
					{ctx}
					of={complianceTableRows}
					key="bim:compliance-findings"
					layout="grid"
					row_class={(row) => (row.finding.status === 'pass' ? undefined : 'bg-muted/15')}
					toolbar={{
						title: t('bim_compliance.title'),
						controls: authorityControls,
						export: true,
						select: false,
						new: false
					}}
					columns={[
						{
							field: 'status',
							label: t('bim_compliance.col_status'),
							width: 96,
							cell: statusCell
						},
						{ field: 'authority', label: t('models.sop_rules.fields.authority'), width: 100 },
						{ field: 'rule_code', label: t('models.sop_rules.fields.code'), width: 132 },
						{
							field: 'rule_name',
							label: t('bim_compliance.col_rule'),
							width: 280,
							cell: ruleCell
						},
						{ field: 'actual', label: t('bim_compliance.col_current'), width: 180 },
						{ field: 'expected', label: t('bim_compliance.expected'), width: 140 },
						{
							field: 'resolution_label',
							label: t('bim_compliance.col_resolution'),
							width: 196,
							cell: resolutionCell
						},
						{
							field: 'affected_count',
							label: t('bim_review.inspect_3d'),
							width: 96,
							align: 'end',
							cell: inspect3dCell
						}
					]}
				/>
			</Bound>
		</Stack>
	{/if}
</Stack>
