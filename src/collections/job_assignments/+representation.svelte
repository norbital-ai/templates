<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { collectionClient } from '../../lib/collection-client.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import {
		Cluster,
		Column,
		Cover,
		Frame,
		Grid,
		Inline,
		Scroll,
		Stack
	} from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { cn } from '@norbital-ai/ui/utils';
	import { Button } from '@norbital-ai/ui/button';
	import { Textarea } from '@norbital-ai/ui/textarea';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { formatFileSize } from '@norbital-ai/ui/utils';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import Icon from '@iconify/svelte';
	import { Option, Schema } from 'effect';
	import JobsRepresentation from '../jobs/+representation.svelte';
	import { formatSingaporeInstant } from '../../lib/format-singapore-instant.js';

	let { record, close }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const dataRendererRuntime = getDataRendererRuntimeContext();
	if (dataRendererRuntime === undefined) {
		throw new Error('Field Operations requires the workspace file URL capability.');
	}

	const platform = getPlatformStateContext();

	/**
	 * Ask the runtime about the collections themselves. App visibility is navigation, not data
	 * authority, and using an app name as a role would make this component leak the existence of a
	 * restricted collection whenever those two lists drifted apart.
	 */
	const suspicionReadAccessQuery = client.system.access.explain({
		action: 'read',
		resource: 'suspicious_activity_logs'
	});
	const mayReadSuspicion = $derived(suspicionReadAccessQuery.current?.allowed === true);
	const suspicionUpdateAccessQuery = $derived(
		mayReadSuspicion
			? client.system.access.explain({
					action: 'update',
					resource: 'suspicious_activity_logs'
				})
			: undefined
	);
	const mayResolveSuspicion = $derived(suspicionUpdateAccessQuery?.current?.allowed === true);
	const communicationReadAccessQuery = client.system.access.explain({
		action: 'read',
		resource: 'communication_logs'
	});
	const mayReadCommunication = $derived(communicationReadAccessQuery.current?.allowed === true);

	const photoFileSchema = Schema.Struct({
		file_name: Schema.String,
		file_size: Schema.optional(Schema.NullOr(Schema.Number)),
		storage_key: Schema.String
	});

	/** An evidence row whose `photo` names no downloadable file is skipped rather than rendered. */
	const decodePhotoFile = Schema.decodeUnknownOption(photoFileSchema);

	const jobQuery = $derived(
		record != null
			? client.db.jobs.findMany({
					where: { id: { eq: record.job_id } },
					limit: 1
				})
			: null
	);
	const variationsQuery = $derived(
		record != null
			? client.db.variation_requests.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { requested_at: 'desc' },
					limit: 50
				})
			: null
	);
	const directEvidenceQuery = $derived(
		record != null
			? client.db.photo_evidence.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { created_at: 'desc' },
					limit: 250
				})
			: null
	);

	/**
	 * Only asked for by somebody who may read it.
	 *
	 * A contractor holds no grant on this collection, so the query would be refused rather than
	 * answered — and a refusal rendered as a loading state that never ends is worse than not asking.
	 * The tab is hidden from them for the same reason; this is the half that keeps the network quiet.
	 */
	const suspicionQuery = $derived(
		record != null && mayReadSuspicion
			? client.db.suspicious_activity_logs.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { created_at: 'asc' },
					limit: 100
				})
			: null
	);
	const suspicionRows = $derived(suspicionQuery?.current ?? []);
	const openSuspicionRows = $derived(suspicionRows.filter((log) => log.resolved_at == null));
	const firstOpenSuspicion = $derived(openSuspicionRows[0]);
	const communicationQuery = $derived(
		record != null && mayReadCommunication
			? client.db.communication_logs.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { sent_at: 'asc' },
					limit: 500
				})
			: null
	);
	const communicationRows = $derived(communicationQuery?.current ?? []);
	/**
	 * What the controller is typing, per log. A refused write keeps the draft available; a successful
	 * write turns the live row into its resolved presentation, so the editor leaves the interface.
	 */
	let resolutionDraft = $state<Record<string, string>>({});
	const resolvingSuspicion = $derived(client.db.suspicious_activity_logs.pending > 0);
	/**
	 * Read through helpers rather than by indexing on the record's key in a prop.
	 *
	 * `authored-system-columns` refuses `log.id` inside a component prop, and the rule is
	 * right: a surface handing the framework its own key back is telling it something it already
	 * knows. These ask about the *log* — what is typed, and whether it is enough to submit.
	 */
	const draftFor = (log: { readonly id: string }): string => resolutionDraft[log.id] ?? '';
	const canResolve = (log: { readonly id: string }): boolean => draftFor(log).trim() !== '';

	/**
	 * Closing a log by saying what was concluded.
	 *
	 * `resolution` and `resolved_at` are written together and never apart: a timestamp without a
	 * sentence is a log somebody dismissed, which is the state this collection exists to make
	 * impossible. The empty draft is refused here rather than disabled-away in the markup alone, so
	 * the rule holds whichever path reaches it.
	 *
	 * The command takes the log rather than a bare key, like the helpers above: `authored-system-columns`
	 * refuses `log.id` inside a component prop, and the id is read where it is data, in the write below.
	 * Mutation pending and failure behavior belongs to the generated collection client; the sync
	 * engine updates the live suspicion query, and a refused write leaves the draft intact.
	 */
	const resolveSuspicion = (log: { readonly id: string }) => {
		if (!canResolve(log)) return;
		const logId = log.id;
		const resolution = (resolutionDraft[logId] ?? '').trim();
		return client.db.suspicious_activity_logs.mutate({
			id: logId,
			resolution,
			resolved_at: new Date().toISOString(),
			resolved_by: platform().user.id
		});
	};

	/** Whether anything is still waiting on a controller — what the accents below turn on. */
	const hasOpenSuspicion = $derived(openSuspicionRows.length > 0);

	const scopedEvidence = $derived(
		(directEvidenceQuery?.current ?? []).filter(
			(evidence) => record != null && evidence.job_assignment_id === record.id
		)
	);
	/**
	 * The photos, composed from the evidence rows and nothing else.
	 *
	 * There was a second query here — every distinct `photo` id fetched out of `document_asset` to
	 * recover a file name and a storage key — and it was both a round trip per record view and a
	 * fetch that returned nothing, because no upload ever wrote the rows it was asking for. The
	 * `photo` column carries the file, so the card is composed from the row already in hand.
	 */
	const photoCards = $derived(
		scopedEvidence.flatMap((evidence) => {
			const parsed = decodePhotoFile(evidence.photo);
			if (Option.isNone(parsed)) return [];
			const file = parsed.value;
			return [
				{
					id: evidence.id,
					name: file.file_name,
					fileSize: file.file_size,
					url: dataRendererRuntime.fileUrl(file.storage_key),
					flags: (evidence.flags ?? []).filter((flag) => flag != null),
					source: evidence.source == null ? null : evidenceSource(evidence.source),
					capturedAt: formatSingaporeInstant(evidence.created_at, t('component.not_recorded'))
				}
			];
		})
	);
	const evidenceLoading = $derived(directEvidenceQuery?.loading === true);
	const evidenceFacts = $derived(
		scopedEvidence.flatMap((evidence) => {
			const facts: Array<{ readonly id: string; readonly label: string }> = [];
			const flags = new Set((evidence.flags ?? []).filter((flag) => flag != null));
			if (flags.has('exact_duplicate')) {
				facts.push({
					id: `${evidence.id}:exact`,
					label: t('component.evidence_fact_exact_match')
				});
			}
			if (flags.has('visual_duplicate')) {
				facts.push({
					id: `${evidence.id}:similar`,
					label: t('component.evidence_fact_similar_match')
				});
			}
			if (flags.has('missing_geolocation')) {
				facts.push({
					id: `${evidence.id}:geolocation`,
					label: t('component.evidence_fact_missing_geolocation')
				});
			}
			if (flags.has('metadata_anomaly')) {
				facts.push({
					id: `${evidence.id}:metadata`,
					label: t('component.evidence_fact_missing_metadata')
				});
			}
			return facts;
		})
	);

	/**
	 * The photo the viewer opened, or nothing.
	 *
	 * A tile used to be an `<a href target="_blank">` straight at `/api/files/…`, which hands the
	 * browser the raw bytes and leaves the record behind — the reviewer loses the job they were
	 * checking the photograph against, which is the one thing they need beside it. An overlay keeps
	 * both and closes on Escape or a click outside.
	 */
	let openedPhoto = $state<(typeof photoCards)[number] | undefined>(undefined);

	function integrityFlagLabel(flag: string): string {
		switch (flag) {
			case 'missing_geolocation':
				return t('component.flag_missing_geolocation');
			case 'location_mismatch':
				return t('component.flag_location_mismatch');
			case 'exact_duplicate':
				return t('component.flag_exact_duplicate');
			case 'visual_duplicate':
				return t('component.flag_visual_duplicate');
			case 'metadata_anomaly':
				return t('component.flag_metadata_anomaly');
			case 'edited_metadata':
				return t('component.flag_edited_metadata');
			case 'low_quality':
				return t('component.flag_low_quality');
			default:
				return flag.replaceAll('_', ' ');
		}
	}

	function evidenceSource(source: unknown): string {
		if (source == null || typeof source !== 'object') return t('component.workspace_upload');
		const kind = Reflect.get(source, 'kind');
		if (kind !== 'channel') return t('component.workspace_upload');
		const provider = Reflect.get(source, 'provider');
		return typeof provider === 'string'
			? t('component.provider_agent', { provider })
			: t('component.channel_agent');
	}

	function formatMoney(value: unknown): string {
		if (value == null || typeof value !== 'object') return t('component.not_recorded');
		const amount = Reflect.get(value, 'value');
		const currency = Reflect.get(value, 'currency');
		if (typeof amount !== 'number' || typeof currency !== 'string')
			return t('component.not_recorded');
		return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(amount);
	}
</script>

{#if record}
	{#snippet suspicionHeader()}
		{#if mayReadSuspicion && hasOpenSuspicion && firstOpenSuspicion}
			<Inline align="start" gap="xs" class="min-w-0 px-1 text-warning" aria-live="polite">
				<Icon icon="lucide:shield-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<p class="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
					<span class="font-semibold">{t('component.suspicion_open')}:</span>
					{firstOpenSuspicion.reason}
				</p>
			</Inline>
		{/if}
	{/snippet}

	{#snippet jobScopeHeader()}
		<div>
			<h3 id="assignment-job-scope-heading" class="text-sm font-semibold">
				{t('component.job_scope')}
			</h3>
			<p class="text-sm text-muted-foreground">
				{t('component.job_scope_description')}
			</p>
		</div>
	{/snippet}

	{#snippet jobScope()}
		<Scroll name={t('component.job_scope_status')}>
			<Stack gap="md">
				<Cover gap="md" top={jobScopeHeader}>
					{#if jobQuery?.current?.[0]}
						<JobsRepresentation record={jobQuery.current[0]} close={() => undefined} />
					{:else if jobQuery?.loading}
						<div
							class="h-32 rounded-md bg-muted/50 motion-safe:animate-pulse"
							aria-label={t('component.loading_job')}
						></div>
					{:else}
						<p class="text-sm text-destructive">{t('component.job_load_failed')}</p>
					{/if}
				</Cover>
			</Stack>
		</Scroll>
	{/snippet}

	{#snippet statusAndActivity()}
		<Stack gap="md">
			<CollectionForm client={collectionClient} collection="job_assignments" defaultValues={record}>
				{#snippet children({ Field })}
					<Stack gap="md">
						<div>
							<h3 id="assignment-activity-heading" class="text-sm font-semibold">
								{t('component.assignment_and_activity')}
							</h3>
							<p class="text-sm text-muted-foreground">
								{t('component.assignment_and_activity_description')}
							</p>
						</div>
						<Grid minimum="panel">
							<Field name="status" />
							<Field name="dispatched_at" label={t('component.dispatched_at')} />
							<Field name="completed_at" label={t('component.completed_at')} />
							<Field name="amount_charged" label={t('component.value_charged')} />
							<Column span="all">
								<Field name="summary" label={t('component.completion_summary')} />
							</Column>
							<Column span="all"
								><Field name="location" label={t('component.reported_location')} /></Column
							>
						</Grid>
					</Stack>
				{/snippet}
			</CollectionForm>
		</Stack>
	{/snippet}

	{#snippet variationHistory()}
		<Scroll name={t('component.variation_history')}>
			<Stack as="section" aria-labelledby="variation-history-heading" gap="md">
				<Inline justify="between" gap="sm">
					<div>
						<h4 id="variation-history-heading" class="text-sm font-semibold">
							{t('component.variations')}
						</h4>
						<p class="text-meta">{t('component.variations_description')}</p>
					</div>
					<span class="text-meta tabular-nums">
						{t('component.recorded_count', { count: variationsQuery?.current?.length ?? 0 })}
					</span>
				</Inline>
				<Stack gap="sm">
					{#each variationsQuery?.current ?? [] as variation (variation.id)}
						<Stack as="section" gap="sm" class="rounded-md border border-border bg-card p-3">
							<Inline align="start" justify="between" gap="sm">
								<Stack gap="xs">
									<p class="text-sm font-medium">{variation.title}</p>
									<p class="text-sm text-muted-foreground">{variation.description}</p>
								</Stack>
								<span class="shrink-0 text-sm font-medium">{formatMoney(variation.amount)}</span>
							</Inline>
							<p class="text-meta">
								{t('component.requested_at_instant', {
									instant: formatSingaporeInstant(
										variation.requested_at,
										t('component.not_recorded')
									)
								})}
							</p>
						</Stack>
					{:else}
						<div
							class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
						>
							{t('component.no_variations')}
						</div>
					{/each}
				</Stack>
			</Stack>
		</Scroll>
	{/snippet}

	{#snippet suspicionLogs()}
		<Stack gap="md">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">{t('component.suspicion_logs')}</h3>
				<p class="text-tiny text-muted-foreground">{t('component.suspicion_logs_description')}</p>
			</Stack>

			<section aria-labelledby="assignment-evidence-facts-heading">
				<Stack gap="sm">
					<h4 id="assignment-evidence-facts-heading" class="text-sm font-semibold">
						{t('component.evidence_facts')}
					</h4>
					<p class="text-tiny text-muted-foreground">
						{t('component.evidence_facts_description')}
					</p>
					{#if evidenceLoading}
						<p class="text-tiny text-muted-foreground">{t('component.loading_evidence')}</p>
					{:else if directEvidenceQuery?.error}
						<p class="text-tiny text-destructive" role="alert">
							{t('component.evidence_load_failed')}
						</p>
					{:else if evidenceFacts.length === 0}
						<p class="text-tiny text-muted-foreground">
							{t('component.evidence_facts_empty')}
						</p>
					{:else}
						<Stack as="ul" gap="xs" class="list-disc ps-5 text-tiny">
							{#each evidenceFacts as fact (fact.id)}
								<li class="break-words [overflow-wrap:anywhere]">{fact.label}</li>
							{/each}
						</Stack>
					{/if}
				</Stack>
			</section>

			<section aria-labelledby="assignment-judgements-heading">
				<Stack gap="sm">
					<h4 id="assignment-judgements-heading" class="text-sm font-semibold">
						{t('component.suspicion_judgements')}
					</h4>
					{#if suspicionQuery?.loading}
						<p class="text-tiny text-muted-foreground">{t('component.loading')}</p>
					{:else if suspicionQuery?.error}
						<p class="text-tiny text-destructive" role="alert">
							{t('component.suspicion_load_failed')}
						</p>
					{:else if suspicionRows.length === 0}
						<p class="text-tiny text-muted-foreground">{t('component.suspicion_logs_empty')}</p>
					{:else}
						<Stack gap="sm">
							{#each suspicionRows as log (log.id)}
								<Stack
									gap="xs"
									class={cn(
										'rounded-md border p-3',
										log.resolved_at == null ? 'border-warning/40 bg-warning/5' : 'border-border'
									)}
								>
									<Inline gap="sm" align="center">
										<Icon
											icon={log.resolved_at == null ? 'lucide:shield-alert' : 'lucide:shield-check'}
											class={cn('size-4 shrink-0', log.resolved_at == null && 'text-warning')}
											aria-hidden="true"
										/>
										<span class="text-tiny font-semibold">
											{log.resolved_at == null
												? t('component.suspicion_open')
												: t('component.suspicion_resolved')}
										</span>
									</Inline>
									<p class="break-words text-tiny [overflow-wrap:anywhere]">{log.reason}</p>
									{#if log.resolved_at != null}
										{#if log.resolution}
											<p
												class="break-words text-tiny text-muted-foreground [overflow-wrap:anywhere]"
											>
												{log.resolution}
											</p>
										{:else}
											<p class="text-tiny text-muted-foreground">
												{t('component.suspicion_resolution_missing')}
											</p>
										{/if}
									{:else if mayResolveSuspicion}
										<Stack gap="xs">
											<Textarea
												rows={2}
												placeholder={t('component.suspicion_resolution_placeholder')}
												value={draftFor(log)}
												oninput={(event) =>
													(resolutionDraft = {
														...resolutionDraft,
														[log.id]: event.currentTarget.value
													})}
											/>
											<Inline gap="sm" align="center">
												<Button
													size="sm"
													disabled={!canResolve(log) || resolvingSuspicion}
													aria-busy={resolvingSuspicion}
													onclick={() => resolveSuspicion(log)}
												>
													{resolvingSuspicion
														? t('component.suspicion_resolving')
														: t('component.suspicion_resolve')}
												</Button>
											</Inline>
										</Stack>
									{:else}
										<p class="text-tiny text-muted-foreground">
											{t('component.suspicion_resolve_unavailable')}
										</p>
									{/if}
								</Stack>
							{/each}
						</Stack>
					{/if}
				</Stack>
			</section>
		</Stack>
	{/snippet}

	{#snippet communicationHistory()}
		<Scroll name={t('component.communication_logs')}>
			<Stack as="section" aria-labelledby="communication-logs-heading" gap="md">
				<Stack gap="xs">
					<h3 id="communication-logs-heading" class="text-sm font-semibold">
						{t('component.communication_logs')}
					</h3>
					<p class="text-tiny text-muted-foreground">
						{t('component.communication_logs_description')}
					</p>
				</Stack>
				{#if communicationQuery?.loading}
					<p class="text-tiny text-muted-foreground">{t('component.loading')}</p>
				{:else if communicationQuery?.error}
					<p class="text-tiny text-destructive" role="alert">
						{t('component.communication_logs_failed')}
					</p>
				{:else if communicationRows.length === 0}
					<p class="text-tiny text-muted-foreground">{t('component.communication_logs_empty')}</p>
				{:else}
					<Stack as="ol" gap="sm">
						{#each communicationRows as entry (entry.source_message_id)}
							<li class="rounded-md border border-border p-3">
								<Stack gap="xs">
									<Cluster align="center" justify="between" gap="sm">
										<span class="break-words text-tiny font-semibold [overflow-wrap:anywhere]">
											{entry.sender}
										</span>
										<time class="text-meta">
											{formatSingaporeInstant(entry.sent_at, t('component.not_recorded'))}
										</time>
									</Cluster>
									<p class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
										{entry.message}
									</p>
								</Stack>
							</li>
						{/each}
					</Stack>
				{/if}
			</Stack>
		</Scroll>
	{/snippet}

	{#snippet photoGallery()}
		<Scroll name={t('component.assignment_evidence')}>
			<Stack as="section" aria-labelledby="evidence-heading" gap="md">
				<Inline justify="between" gap="sm">
					<div>
						<h4 id="evidence-heading" class="text-sm font-semibold">{t('component.evidence')}</h4>
						<p class="text-meta">{t('component.evidence_description')}</p>
					</div>
					<span class="text-meta tabular-nums">
						{evidenceLoading
							? t('component.loading_evidence')
							: t('component.captured_for_assignment', { count: photoCards.length })}
					</span>
				</Inline>
				{#if directEvidenceQuery?.error}
					<p class="text-sm text-destructive" role="alert">
						{t('component.evidence_load_failed')}
					</p>
				{:else if evidenceLoading && photoCards.length === 0}
					<Grid minimum="card" gap="md" aria-label={t('component.loading_photo_evidence')}>
						{#each Array(3) as _}
							<div class="h-48 rounded-md bg-muted/50 motion-safe:animate-pulse"></div>
						{/each}
					</Grid>
				{:else}
					<Grid minimum="card" gap="md">
						{#each photoCards as photo (photo.id)}
							<figure class="min-w-0 rounded-md border border-border bg-card">
								<button
									type="button"
									onclick={() => (openedPhoto = photo)}
									class="group block w-full bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
									aria-label={t('component.open_photo', { name: photo.name })}
								>
									<Frame ratio="landscape">
										<img
											src={photo.url}
											alt={photo.name}
											class="transition-opacity duration-150 group-hover:opacity-90"
											loading="lazy"
											decoding="async"
										/>
									</Frame>
								</button>
								<Stack as="section" gap="sm" class="p-3">
									<Inline align="start" gap="xs">
										<Icon
											icon={mayReadSuspicion && photo.flags.length > 0
												? 'lucide:scan-search'
												: 'lucide:image'}
											class="mt-0.5 size-4 shrink-0 text-muted-foreground"
											aria-hidden="true"
										/>
										<Stack gap="none" class="min-w-0">
											<p class="truncate text-sm font-medium">{photo.name}</p>
											<p class="text-meta">
												{photo.source == null
													? photo.capturedAt
													: `${photo.source} · ${photo.capturedAt}`}
											</p>
										</Stack>
									</Inline>
									{#if mayReadSuspicion}
										<Cluster justify="between" gap="xs" class="text-xs">
											<span class="text-muted-foreground">
												{photo.flags.length > 0
													? photo.flags.map(integrityFlagLabel).join(' · ')
													: t('component.evidence_no_recorded_facts')}
											</span>
											{#if photo.fileSize != null}
												<span class="shrink-0 tabular-nums text-muted-foreground">
													{formatFileSize(photo.fileSize)}
												</span>
											{/if}
										</Cluster>
									{:else}
										{#if photo.fileSize != null}
											<p class="text-meta tabular-nums">
												{formatFileSize(photo.fileSize)}
											</p>
										{/if}
									{/if}
								</Stack>
							</figure>
						{:else}
							<Column span="all">
								<div
									class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
								>
									{t('component.no_evidence')}
								</div>
							</Column>
						{/each}
					</Grid>
				{/if}
			</Stack>
		</Scroll>
	{/snippet}

	<Stack gap="sm">
		{@render suspicionHeader()}
		<Tabs
			animate={false}
			contentPadding={false}
			listClass="mx-0 w-full"
			config={[
				{
					name: 'scope',
					label: t('component.job_scope'),
					icon: 'lucide:briefcase-business',
					content: jobScope
				},
				{
					name: 'activity',
					label: t('component.status_and_activity'),
					icon: 'lucide:clipboard-check',
					content: statusAndActivity
				},
				{
					name: 'variations',
					label: t('component.variations'),
					icon: 'lucide:git-pull-request-arrow',
					content: variationHistory
				},
				{
					name: 'photos',
					label: t('component.photos'),
					icon: 'lucide:images',
					content: photoGallery
				},
				...(mayReadCommunication
					? [
							{
								name: 'communications',
								label: t('component.communication_logs'),
								icon: 'lucide:messages-square',
								content: communicationHistory
							}
						]
					: []),
				...(mayReadSuspicion
					? [
							{
								name: 'suspicions',
								label: t('component.suspicion_logs'),
								icon: 'lucide:shield-alert',
								content: suspicionLogs
							}
						]
					: [])
			] satisfies TabConfig[]}
		/>
	</Stack>
{:else}
	<CollectionForm
		client={collectionClient}
		collection="job_assignments"
		submitLabel={t('component.create_assignment')}
		onAfterSubmit={close}
	>
		{#snippet children({ Field })}
			<Grid minimum="panel">
				<Field
					name="job_id"
					label={t('component.job')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'jobs',
						options: {
							label: (record) => {
								const v = record.title;
								return v != null && v !== '' ? String(v) : '—';
							},
							orderBy: { title: 'asc' },
							limit: 500
						}
					}}
				/>
				<!--
					The assignee is a person, so the picker reads the identity directory directly.

					`user` is granted to any authenticated subject masked to `id` and
					`name`; there is no workspace collection describing a contractor to point at, and the one
					that used to be here carried nothing this row does not.
				-->
				<Field
					name="assignee_user_id"
					label={t('component.contractor')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'user',
						options: {
							label: (record) => {
								const v = record.name;
								return v != null && v !== '' ? String(v) : '—';
							},
							orderBy: { name: 'asc' },
							limit: 500
						}
					}}
				/>
			</Grid>
		{/snippet}
	</CollectionForm>
{/if}

<!--
	The opened photograph, over the record rather than instead of it.

	`Dialog` gives Escape, a click on the backdrop, and focus return to the tile for free. The image
	is the same URL the tile used, so it is already in the browser cache by the time the overlay
	opens and appears instantly at full size.
-->
<Dialog.Root
	open={openedPhoto !== undefined}
	onOpenChange={(open) => {
		if (!open) openedPhoto = undefined;
	}}
>
	<Dialog.Content class="max-w-5xl">
		{#if openedPhoto}
			<Dialog.Header>
				<Dialog.Title>{openedPhoto.name}</Dialog.Title>
			</Dialog.Header>
			<img
				src={openedPhoto.url}
				alt={openedPhoto.name}
				class="max-h-[75dvh] w-full rounded-md object-contain"
				decoding="async"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
