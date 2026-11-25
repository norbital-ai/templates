<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		Alert,
		Badge,
		Button,
		Field,
		Icon,
		RecordForm,
		type RecordView,
		RunStatus,
		Section,
		Show,
		Surface,
		use_act
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { formatCarbon, toNumber } from '../../../../lib/commercial.js';
	import {
		extractBimFromFile,
		extractBimFromUrl,
		type BimTakeoffProgress
	} from '../../../../lib/ifc-viewer/ifc_takeoff.js';

	let { view, ctx }: { view: RecordView<'cost_estimates'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canAnalyzeBim = $derived(ctx.catalog?.cost_estimates?.update !== undefined);
	const analyze = use_act(ctx);
	let lastRunId = $state<string | null>(null);
	let streaming = $state(false);
	let streamNotice = $state<string | null>(null);
	let streamError = $state<string | null>(null);
	let localIfcInput = $state<HTMLInputElement | null>(null);
	const money = { kind: 'money', currency: 'currency' } as const;

	const projectQuery = $derived(
		record?.project_id != null
			? ctx.query({
					projects: {
						where: { id: { eq: record.project_id } },
						fields: ['bim_file'],
						limit: 1
					}
				})
			: null
	);
	const projectBimFile = $derived(projectQuery?.current?.projects.rows[0]?.bim_file ?? null);

	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);

	function formatProgress(progress: BimTakeoffProgress): string {
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

	function triggerReanalyze(): void {
		if (!record || projectBimFile == null || streaming || analyze.pending) return;
		streamError = null;
		streamNotice = null;
		streaming = true;
		fork(
			extractBimFromUrl(ctx.file_url(projectBimFile), (progress) => {
				streamNotice = formatProgress(progress);
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						streaming = false;
						streamNotice = null;
						streamError = error.message;
					},
					onSuccess: (res) => {
						streaming = false;
						streamNotice = t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							visuals: res.visualCapturedCount,
							ms: res.durationMs
						});
						analyze.run(
							ctx.run('analyze_bim_file', {
								project_id: record.project_id,
								estimate_id: record.id,
								extracted_model: res.extracted
							}),
							{
								then: (handle) => {
									lastRunId = handle.output.id;
								}
							}
						);
					}
				})
			)
		);
	}

	function handleLocalIfcSelected(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;
		const file = target.files?.[0];
		target.value = '';
		if (!file || !record || streaming || analyze.pending) return;
		streamError = null;
		streamNotice = null;
		streaming = true;
		fork(
			extractBimFromFile(file, (progress) => {
				streamNotice = formatProgress(progress);
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						streaming = false;
						streamNotice = null;
						streamError = error.message;
					},
					onSuccess: (res) => {
						streaming = false;
						streamNotice = t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							visuals: res.visualCapturedCount,
							ms: res.durationMs
						});
						analyze.run(
							ctx.run('analyze_bim_file', {
								project_id: record.project_id,
								estimate_id: record.id,
								extracted_model: res.extracted
							}),
							{
								then: (handle) => {
									lastRunId = handle.output.id;
								}
							}
						);
					}
				})
			)
		);
	}
</script>

{#snippet headerActions()}
	{#if canAnalyzeBim && record && (record.status === 'draft' || record.status === 'void')}
		<input
			bind:this={localIfcInput}
			type="file"
			accept=".ifc,application/octet-stream"
			class="hidden"
			onchange={handleLocalIfcSelected}
		/>
		{#if projectBimFile != null}
			<Button variant="outline" disabled={analyze.pending || streaming} onclick={triggerReanalyze}>
				<Icon name="lucide:scan-line" class="size-3.5" />
				{t('bim_costing.reanalyze_bim')}
			</Button>
		{/if}
		<Button
			variant="outline"
			disabled={analyze.pending || streaming}
			onclick={() => localIfcInput?.click()}
		>
			<Icon name="lucide:upload" class="size-3.5" />
			{t('bim_costing.scan_local_ifc')}
		</Button>
	{/if}
{/snippet}

<RecordForm
	{ctx}
	{view}
	subtitle={['status', 'currency']}
	actions={headerActions}
	{...record ? { runs: [{ ctx, automation: 'analyze_bim_file', limit: 5 }] } : {}}
>
	{#if streamError}
		<Alert.Root variant="destructive">
			<Alert.Title>{streamError}</Alert.Title>
		</Alert.Root>
	{:else if streamNotice}
		<Alert.Root>
			<Alert.Title>{streamNotice}</Alert.Title>
		</Alert.Root>
	{/if}
	{#if lastRunId}
		<RunStatus {ctx} automation="analyze_bim_file" run={lastRunId} />
	{/if}

	{#if record && (record.bim_asset_count > 0 || toNumber(record.bim_subtotal) !== 0 || toNumber(record.total_estimate) !== 0)}
		<Surface tone="card" padding="md" radius="control">
			<Grid minimum="card" gap="md">
				{#if record.bim_asset_count > 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.coverage')}</span>
						<Inline gap="xs" align="center">
							<span class="text-label tabular-nums">
								{`${record.classified_asset_count} / ${record.bim_asset_count}`}
							</span>
							{#if record.unmatched_asset_count > 0}
								<Badge variant="warning">
									{t('bim_costing.unmatched_badge', { count: record.unmatched_asset_count })}
								</Badge>
							{/if}
						</Inline>
					</Stack>
				{/if}
				{#if toNumber(record.bim_subtotal) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.bim_subtotal')}</span>
						<span class="text-label tabular-nums">
							<Show {ctx} kind={money} value={record.bim_subtotal} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.contingency_amount) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.contingency')}</span>
						<span class="text-label tabular-nums">
							<Show {ctx} kind={money} value={record.contingency_amount} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.total_estimate) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.total_estimate')}</span>
						<span class="text-sm font-medium tabular-nums text-primary">
							<Show {ctx} kind={money} value={record.total_estimate} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.carbon_total) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.carbon_total')}</span>
						<span class="text-label tabular-nums">{formatCarbon(record.carbon_total)}</span>
					</Stack>
				{/if}
			</Grid>
		</Surface>
	{/if}

	<Section icon="lucide:calculator" first name="estimate" title={t('section.cost_estimate')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="currency" />
			<Field {ctx} name="contingency_pct" />
			{#if record}
				<Field {ctx} name="contingency_amount" readonly />
				{#if record.analyzed_at != null}
					<Field {ctx} name="analyzed_at" readonly />
				{/if}
			{/if}
		</Grid>
	</Section>

	<Section icon="lucide:box" name="bim_takeoff" title={t('section.bim_asset_takeoff')}>
		<Field {ctx} name="bim_assets" />
	</Section>

	<Section icon="lucide:file-text" name="notes" title={t('section.notes')} default_open={false}>
		<Field {ctx} name="notes" />
	</Section>
</RecordForm>
