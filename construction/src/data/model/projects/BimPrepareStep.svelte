<script lang="ts">
	/**
	 * BIM Costing — Step 1 (`prepare`):
	 * Flat, scannable review workspace backed by collapsible `<Section>`s (zero stacked view-tab bars):
	 * 1. Proposed Item Matrix & Costings (inline edit & commercial approval)
	 * 2. Proposed Clean BIM (inline edit class/continuity/service/mapping + Download Clean BIM)
	 * 3. Compliance & SOP Lints (BCA / SCDF / PUB / URA / CORENET X / SOP scorecard + 3D inspect)
	 */
	import type { CurrencyCode, FileRef, Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		format,
		Icon,
		Progress,
		RunStatus,
		Section,
		Spinner,
		toast
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import { Effect, Schema } from 'effect';
	import {
		cleanAndOrganizeIfcStep,
		type BimAssetOverride
	} from '../../../services/bim/organizer.js';
	import { ExtractedBimModelSchema, type BimTakeoffLine } from '../../../services/bim/schema.js';
	import { downloadTextFile, safeFilename } from '../../../services/ui/download.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';
	import { fetchEffect } from '../../../services/viewer/types.js';
	import BimAssetReview from './BimAssetReview.svelte';
	import BimItemMatrixReview from './BimItemMatrixReview.svelte';

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
		status,
		activeRun = null,
		busy = false,
		canAnalyze = false,
		costingLocked = false,
		onRunPrepare,
		onRetakeoff,
		onRunCost,
		onInspect3d,
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
		status: {
			readonly text: string;
			readonly tone: 'muted' | 'locked' | 'warning' | 'error' | 'busy';
		};
		activeRun?: { readonly id: string } | null;
		busy?: boolean;
		canAnalyze?: boolean;
		costingLocked?: boolean;
		onRunPrepare?: () => void;
		onRetakeoff?: () => void;
		onRunCost?: () => void;
		onInspect3d?: (expressIds: readonly number[], label: string) => void;
		onMutated?: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);

	let authorityFilter = $state<string>('all');
	let exportingIfc = $state(false);
	let matrixSectionEl = $state<HTMLDivElement | null>(null);

	const hasPrepared = $derived(
		bimTakeoff != null || signatures.length > 0 || compliance != null || bimSummary != null
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
	const uniqueLinkedItemCount = $derived(
		new Set(projectMappings.flatMap((r) => (r.item_id ? [r.item_id.id] : []))).size
	);
	const unreviewedAssetCount = $derived(
		projectMappings.filter((r) => r.review_status !== 'verified').length
	);

	const authorities = $derived([
		'all',
		...[...new Set((compliance?.findings ?? []).map((f) => f.authority))].sort()
	]);
	const visibleFindings = $derived(
		(compliance?.findings ?? []).filter(
			(f) => authorityFilter === 'all' || f.authority === authorityFilter
		)
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

	const primaryRunStep1 = $derived(
		!hasPrepared || status.tone === 'warning' || status.tone === 'error'
	);

	const matrixSummary = $derived(
		pendingProposalCount > 0
			? t('bim_step.pending_approval_count', { count: pendingProposalCount })
			: t('bim_step.filter_all_matrix', { count: uniqueLinkedItemCount })
	);

	const cleanBimSummary = $derived(
		unreviewedAssetCount > 0
			? `${signatures.length} · ${t('bim_review.filter_needs_review', { count: unreviewedAssetCount })}`
			: t('bim_step.tab_clean_bim', { count: signatures.length })
	);

	const complianceSummary = $derived(
		compliance
			? `${compliance.score_pct}% · ${compliance.fail_count} ${t('bim_compliance.failures')} · ${compliance.warn_count} ${t('bim_compliance.warnings')}`
			: t('bim_step.tab_compliance')
	);
</script>

<Stack gap="md">
	<Surface tone="card" padding="md" radius="control">
		<Stack gap="sm">
			<Cluster align="center" justify="between" gap="sm">
				<Stack gap="xs">
					<span class="text-label">{t('bim_step.phase1_title')}</span>
					<p
						class={[
							'flex min-w-0 items-center gap-1.5 text-xs',
							status.tone === 'error'
								? 'text-destructive'
								: status.tone === 'warning'
									? 'text-warning'
									: 'text-muted-foreground'
						]}
						aria-live="polite"
					>
						{#if status.tone === 'busy'}
							<Spinner class="size-3.5 shrink-0" />
						{:else}
							<Icon
								name={status.tone === 'muted'
									? 'lucide:circle-check'
									: status.tone === 'locked'
										? 'lucide:lock'
										: 'lucide:triangle-alert'}
								class="size-3.5 shrink-0"
							/>
						{/if}
						<span class="truncate">{status.text}</span>
					</p>
					{#if activeRun}
						<RunStatus {ctx} automation="analyze_bim_file" run={activeRun} />
					{/if}
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
					{#if canAnalyze && bimFile && onRunPrepare}
						<Button
							variant={primaryRunStep1 ? 'brand' : 'outline'}
							disabled={busy}
							onclick={onRunPrepare}
						>
							{#if busy}
								<Spinner class="size-3.5" />
							{:else}
								<Icon name="lucide:scan-line" class="size-3.5" />
							{/if}
							{hasPrepared ? t('bim_step.rerun_phase1') : t('bim_step.run_phase1')}
						</Button>
					{/if}
					{#if canAnalyze && bimFile && bimTakeoff && onRetakeoff}
						<Button variant="outline" disabled={busy} onclick={onRetakeoff}>
							<Icon name="lucide:refresh-cw" class="size-3.5" />
							{t('bim_step.reparse_ifc')}
						</Button>
					{/if}
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
					{#if canAnalyze && bimTakeoff && onRunCost}
						<Button
							variant={!primaryRunStep1 ? 'brand' : 'outline'}
							disabled={busy || costingLocked}
							hint={costingLocked ? t('bim_costing.locked_hint') : t('bim_step.run_phase2_hint')}
							onclick={onRunCost}
						>
							<Icon name="lucide:arrow-right" class="size-3.5" />
							{t('bim_step.proceed_phase2')}
						</Button>
					{/if}
				</Cluster>
			</Cluster>
		</Stack>
	</Surface>

	{#if !hasPrepared}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_step.phase1_title')}
			hint={bimFile ? t('bim_step.phase1_empty_hint') : t('bim_costing.status_no_model')}
		>
			{#if canAnalyze && bimFile && onRunPrepare}
				<Button variant="outline" disabled={busy} onclick={onRunPrepare}>
					<Icon name="lucide:scan-line" class="size-3.5" />
					{t('bim_step.run_phase1')}
				</Button>
			{/if}
		</EmptyState>
	{:else}
		<div bind:this={matrixSectionEl}>
			<Section
				first
				name="bim_step1_item_matrix"
				title={t('bim_step.matrix_heading')}
				icon="lucide:table-2"
				hint={t('bim_step.matrix_hint')}
				summary={matrixSummary}
				default_open={pendingProposalCount > 0}
			>
				{#snippet trailing()}
					{#if pendingProposalCount > 0}
						<Badge variant="warning" class="text-tiny">
							{t('bim_step.pending_approval_count', { count: pendingProposalCount })}
						</Badge>
					{/if}
				{/snippet}
				<BimItemMatrixReview
					{ctx}
					{currency}
					assetLinks={projectMappings}
					{...onMutated ? { onMutated } : {}}
				/>
			</Section>
		</div>

		<Section
			name="bim_step1_clean_bim"
			title={t('bim_step.clean_bim_heading')}
			icon="lucide:shapes"
			summary={cleanBimSummary}
			default_open={true}
		>
			<BimAssetReview
				{ctx}
				{signatures}
				{bimAssets}
				{...onInspect3d ? { onInspect3d } : {}}
				onReviewProposals={() =>
					matrixSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
				{...onMutated ? { onMutated } : {}}
			/>
		</Section>

		<Section
			name="bim_step1_compliance"
			title={t('bim_compliance.title')}
			icon="lucide:shield-check"
			summary={complianceSummary}
			default_open={compliance != null && (compliance.fail_count > 0 || compliance.warn_count > 0)}
		>
			{#snippet trailing()}
				{#if compliance}
					<Badge
						variant={compliance.fail_count > 0
							? 'destructive'
							: compliance.warn_count > 0
								? 'warning'
								: 'success'}
					>
						{`${compliance.score_pct}%`}
					</Badge>
				{/if}
			{/snippet}
			{#if compliance}
				<Stack gap="md">
					<Cluster align="center" justify="between" gap="sm">
						<span class="text-meta">
							{t('bim_compliance.checked_at', {
								when: format({ kind: 'instant' }, compliance.checked_at, { locale: ctx.locale })
							})}
						</span>
						{#if canAnalyze && bimFile && onRunPrepare}
							<Button variant="outline" disabled={busy} onclick={onRunPrepare}>
								<Icon name="lucide:refresh-cw" class="size-3.5" />
								{t('bim_compliance.recheck')}
							</Button>
						{/if}
					</Cluster>

					<Grid minimum="card" gap="md">
						<Stack gap="xs">
							<span class="text-meta">{t('bim_compliance.score_label')}</span>
							<Progress value={compliance.score_pct} max={100} class="h-2" />
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

					<Surface tone="card" padding="none" radius="control">
						<Stack gap="none" divided>
							{#each visibleFindings as f (f.rule_code)}
								<Surface
									tone={f.status === 'pass' ? 'transparent' : 'subtle'}
									padding="sm"
									radius="none"
									bordered={false}
								>
									<Cluster align="center" justify="between" gap="sm">
										<Stack gap="xs">
											<Cluster gap="xs" align="center">
												<Badge variant={statusBadgeVariant(f.status)} class="text-tiny">
													{f.status.toUpperCase()}
												</Badge>
												<Badge variant="outline" class="font-mono text-tiny">
													{`${authorityLabel(f.authority)} · ${f.rule_code}`}
												</Badge>
												<span class="text-label">{f.rule_name}</span>
											</Cluster>
											<Cluster gap="xs" align="center">
												<span class="font-mono text-xs text-foreground">{f.actual}</span>
												<span class="text-meta">
													{`(${t('bim_compliance.expected')}: ${f.expected})`}
												</span>
												{#if f.clause_ref}
													<span class="text-meta">{`· ${f.clause_ref}`}</span>
												{/if}
											</Cluster>
											{#if f.status !== 'pass' && f.remediation}
												<span class="text-meta">{f.remediation}</span>
											{/if}
										</Stack>
										{#if f.status !== 'pass' && onInspect3d && f.sample_express_ids?.length}
											<Button
												variant="outline"
												onclick={() =>
													onInspect3d(
														f.sample_express_ids ?? [],
														`${f.rule_code} · ${f.rule_name}`
													)}
											>
												<Icon name="lucide:box" class="size-3.5" />
												{`${t('bim_review.inspect_3d')} (${f.affected_count})`}
											</Button>
										{/if}
									</Cluster>
								</Surface>
							{/each}
						</Stack>
					</Surface>
				</Stack>
			{:else}
				<EmptyState
					variant="card"
					icon="file"
					title={t('bim_compliance.title')}
					hint={t('bim_compliance.empty')}
				/>
			{/if}
		</Section>
	{/if}
</Stack>
