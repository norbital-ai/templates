<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		Alert,
		Badge,
		Button,
		Field,
		Icon,
		Picker,
		RunStatus,
		Section,
		Show,
		Surface,
		use_act,
		use_record_controller,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect, Option, Schema } from 'effect';
	import { toNumber } from '../../../../lib/commercial.js';
	import { extractBimFromFile, extractBimFromUrl } from '../../../../lib/ifc-viewer/ifc_takeoff.js';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'cost_estimates'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canAnalyzeBim = $derived(
		ctx.catalog?.cost_estimates?.create !== undefined ||
			ctx.catalog?.project_files?.create !== undefined
	);
	const analyze = use_act(ctx);
	let lastRunId = $state<string | null>(null);
	let streaming = $state(false);
	let streamNotice = $state<string | null>(null);
	let streamError = $state<string | null>(null);
	let localIfcInput = $state<HTMLInputElement | null>(null);
	const money = { kind: 'money', currency: 'currency' } as const;

	const linkedFileQuery = $derived(
		record?.bim_file_id != null
			? ctx.query({
					project_files: {
						where: { id: { eq: record.bim_file_id } },
						fields: ['file'],
						limit: 1
					}
				})
			: null
	);
	const linkedFileRef = $derived(linkedFileQuery?.current?.project_files.rows[0]?.file ?? null);

	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const fixedProject = $derived(
		record?.project_id ??
			(view.mode === 'create' && typeof view.values.project_id === 'string'
				? view.values.project_id
				: null)
	);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
	const scopedProject = $derived.by(() => {
		const raw = liveForm?.get('project_id');
		const id = typeof raw === 'string' ? raw : fixedProject;
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('projects'))(id));
	});

	function triggerReanalyze(): void {
		if (!record || record.bim_file_id == null || streaming || analyze.pending) return;
		const bimFileId = record.bim_file_id;
		streamError = null;
		streamNotice = null;
		if (linkedFileRef != null) {
			streaming = true;
			fork(
				extractBimFromUrl(ctx.file_url(linkedFileRef), (progress) => {
					streamNotice = t('bim_costing.streaming_progress', {
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
							streamNotice = t('bim_costing.streaming_done', {
								assets: res.extracted.total_asset_count,
								archetypes: res.extracted.archetypes.length,
								ms: res.durationMs
							});
							analyze.run(
								ctx.run('analyze_bim_file', {
									project_file_id: bimFileId,
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
			return;
		}
		analyze.run(
			ctx.run('analyze_bim_file', {
				project_file_id: bimFileId,
				estimate_id: record.id
			}),
			{
				then: (handle) => {
					lastRunId = handle.output.id;
				}
			}
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
				streamNotice = t('bim_costing.streaming_progress', {
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
						streamNotice = t('bim_costing.streaming_done', {
							assets: res.extracted.total_asset_count,
							archetypes: res.extracted.archetypes.length,
							ms: res.durationMs
						});
						analyze.run(
							ctx.run('analyze_bim_file', {
								project_id: record.project_id,
								estimate_id: record.id,
								...(record.bim_file_id != null ? { project_file_id: record.bim_file_id } : {}),
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

{#snippet bimFileEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="project_files"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet contractEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="contracts"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet headerActions()}
	{#if canAnalyzeBim && record && record.status === 'draft'}
		<input
			bind:this={localIfcInput}
			type="file"
			accept=".ifc,application/octet-stream"
			class="hidden"
			onchange={handleLocalIfcSelected}
		/>
		{#if record.bim_file_id != null}
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

	{#if record && (record.bim_asset_count > 0 || toNumber(record.bim_subtotal) !== 0 || toNumber(record.additional_subtotal) !== 0 || toNumber(record.total_estimate) !== 0)}
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
				{#if toNumber(record.additional_subtotal) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.additional_subtotal')}</span>
						<span class="text-label tabular-nums">
							<Show {ctx} kind={money} value={record.additional_subtotal} row={record} />
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
			</Grid>
		</Surface>
	{/if}

	<Section icon="lucide:calculator" first name="estimate" title={t('section.cost_estimate')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="bim_file_id" editor={bimFileEditor} />
			<Field {ctx} name="contract_id" editor={contractEditor} />
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

	<Section icon="lucide:plus-circle" name="additional" title={t('section.additional_costings')}>
		<Field {ctx} name="additional_costs" />
	</Section>

	<Section icon="lucide:file-text" name="notes" title={t('section.notes')} default_open={false}>
		<Field {ctx} name="notes" />
	</Section>
</RecordForm>
