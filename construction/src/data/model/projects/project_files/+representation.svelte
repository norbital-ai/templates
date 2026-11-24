<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Alert,
		Button,
		Field,
		Icon,
		RunStatus,
		Section,
		use_act,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { extractBimFromUrl } from '../../../../lib/ifc-viewer/ifc_takeoff.js';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'project_files'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canAnalyzeBim = $derived(
		ctx.catalog?.cost_estimates?.create !== undefined ||
			ctx.catalog?.project_files?.create !== undefined
	);
	const revCount = $derived(record?.revisions?.length ?? 0);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
	const analyze = use_act(ctx);
	let lastRunId = $state<string | null>(null);
	let streamNotice = $state<string | null>(null);
	let streamError = $state<string | null>(null);
	let streaming = $state(false);

	function triggerAnalyze(): void {
		if (!record || record.file == null || streaming || analyze.pending) return;
		streamError = null;
		streamNotice = null;
		streaming = true;
		const url = ctx.file_url(record.file);
		fork(
			extractBimFromUrl(url, (progress) => {
				streamNotice = ctx.t('bim_costing.streaming_progress', {
					percent: progress.percent,
					assets: progress.rawAssets
				});
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						streaming = false;
						streamNotice = null;
						streamError = error.message;
					},
					onSuccess: (res) => {
						streaming = false;
						streamNotice = ctx.t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							ms: res.durationMs
						});
						analyze.run(
							ctx.run('analyze_bim_file', {
								project_file_id: record.id,
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
	{#if canAnalyzeBim && record && record.kind === 'ifc_model' && record.file != null}
		<Button variant="outline" disabled={analyze.pending || streaming} onclick={triggerAnalyze}>
			<Icon name="lucide:scan-line" class="size-3.5" />
			{ctx.t('bim_costing.run_pipeline')}
		</Button>
	{/if}
{/snippet}

<RecordForm
	{ctx}
	{view}
	subtitle={['kind', 'current_version', 'status']}
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

	<Section icon="lucide:file-box" first name="file" title={ctx.t('section.project_file')}>
		<Grid minimum="card">
			<Field {ctx} name="document_number" />
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="kind" />
			<Field {ctx} name="discipline" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="zone" />
			<Field {ctx} name="current_version" />
			<Field {ctx} name="autodesk_urn" />
			<Column span="all"><Field {ctx} name="file" /></Column>
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
	{#if record?.bim_summary != null}
		<Section
			icon="lucide:box"
			name="bim_summary"
			title={ctx.t('section.bim_analysis_summary')}
			default_open={false}
		>
			<Field {ctx} name="bim_summary" readonly />
		</Section>
	{/if}
	{#if record && revCount > 0}
		<Section
			icon="lucide:history"
			name="revisions"
			title={ctx.t('project_files.revision_history')}
			default_open={false}
			summary={ctx.t('project_files.revision_count', { count: revCount })}
		>
			<Field {ctx} name="revisions" readonly />
		</Section>
	{/if}
</RecordForm>
