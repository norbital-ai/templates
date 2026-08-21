<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n, type I18nApi } from '@norbital-ai/ui/i18n';
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
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import Icon from '@iconify/svelte';
	import { Option, Schema } from 'effect';
	import JobsRepresentation from '../jobs/+representation.svelte';

	let { record, close, refresh }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * Flag visibility is reserved for dispatch. Contractors see their evidence photos but never the
	 * integrity results, so the shared assignment sheet hides them from a viewer who does not hold
	 * the controller policy.
	 *
	 * This used to look the viewer up in `contractor_profiles` by
	 * `getPlatformStateContext()().user.norbital_id` — a value the shell builds from the display name,
	 * not an id — so the lookup failed against the `uuid()` column for every viewer alive and
	 * `isContractorViewer` was permanently `false`. Every contractor opening this sheet was shown the
	 * controller-only integrity overlay. That collection no longer exists; nothing here fetches a
	 * record to decide who is looking.
	 *
	 * `platform.apps` is `AccessControl.visibleApps`: the whole registry for an `admin` status, and
	 * otherwise the apps the policies of the viewer's one team declare. Only
	 * `field_ops_controller.policy.ts` names the controller app, so its absence is exactly "this
	 * person does not dispatch". It also fails the safe way: the shell seeds the list empty and fills
	 * it when the runtime answers, so a viewer reads as a contractor until proven otherwise and the
	 * overlay stays hidden through load rather than flashing.
	 */
	const platform = getPlatformStateContext();
	const isContractorViewer = $derived(!platform().apps.includes('field_ops_controller'));

	/**
	 * The progress a contractor may see. The assignment's own status carries the integrity overlay
	 * (`suspect`), which is controller-only; the linked job's status mirrors the assignment's real
	 * progression (assigned/in_progress/completed) and never carries the overlay.
	 */
	function contractorProgressLabel(): string {
		const jobStatus = jobQuery?.current?.[0]?.status;
		switch (jobStatus) {
			case 'assigned':
				return t('component.status_assigned');
			case 'in_progress':
				return t('component.status_in_progress');
			case 'completed':
				return t('component.status_completed');
			default:
				return '—';
		}
	}

	type Translator = I18nApi<TenantI18nKeys>['t'];

	/** Render an instant for a Singapore-local reader without depending on the viewer's browser zone. */
	function formatSingaporeInstant(value: string | Date | null | undefined, t: Translator): string {
		if (!value) return t('component.not_recorded');
		return new Intl.DateTimeFormat('en-SG', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'Asia/Singapore'
		}).format(new Date(value));
	}

	const documentAssetSchema = Schema.Struct({
		norbital_id: Schema.String.check(Schema.isUUID()),
		file_name: Schema.String,
		file_size: Schema.optional(Schema.NullOr(Schema.Number)),
		storage_key: Schema.String
	});

	/** An asset row that does not carry a downloadable file is skipped rather than rendered. */
	const decodeDocumentAsset = Schema.decodeUnknownOption(documentAssetSchema);

	const jobQuery = $derived(
		record != null
			? client.db.jobs.findMany({
					where: { norbital_id: { eq: record.job_id } },
					limit: 1
				})
			: null
	);
	const variationsQuery = $derived(
		record != null
			? client.db.variation_requests.findMany({
					where: { job_assignment_id: { eq: record.norbital_id } },
					orderBy: { requested_at: 'desc' },
					limit: 50
				})
			: null
	);
	const directEvidenceQuery = $derived(
		record != null
			? client.db.photo_evidence.findMany({
					where: { job_assignment_id: { eq: record.norbital_id } },
					orderBy: { norbital_created_at: 'desc' },
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
		record != null && !isContractorViewer
			? client.db.suspicious_activity_logs.findMany({
					where: { job_assignment_id: { eq: record.norbital_id } },
					orderBy: { norbital_created_at: 'desc' },
					limit: 100
				})
			: null
	);
	const suspicionRows = $derived(suspicionQuery?.current ?? []);
	/** What the controller is typing, per log. Cleared once the write lands. */
	let resolutionDraft = $state<Record<string, string>>({});
	let resolvingId = $state<string | null>(null);
	let resolveFailure = $state<string | null>(null);

	/**
	 * Closing a log by saying what was concluded.
	 *
	 * `resolution` and `resolved_at` are written together and never apart: a timestamp without a
	 * sentence is a log somebody dismissed, which is the state this collection exists to make
	 * impossible. The empty draft is refused here rather than disabled-away in the markup alone, so
	 * the rule holds whichever path reaches it.
	 */
	const resolveSuspicion = async (logId: string): Promise<void> => {
		const resolution = (resolutionDraft[logId] ?? '').trim();
		if (resolution === '' || resolvingId !== null) return;
		resolvingId = logId;
		resolveFailure = null;
		try {
			/**
			 * `update` is optional on the client, so its absence is answered rather than chained past.
			 *
			 * `?.` would have made a viewer who cannot write look exactly like one whose write
			 * succeeded — the draft clears, the log stays open, and nothing says why. A workspace that
			 * did not grant the write should say so.
			 *
			 * `resolved_at` is a `Date` and not an ISO string: the column is a timestamp and the client
			 * types it as one.
			 */
			const write = client.db.suspicious_activity_logs.update;
			if (write === undefined) {
				resolveFailure = t('component.suspicion_resolve_unavailable');
				return;
			}
			await write(logId, {
				resolution,
				resolved_at: new Date(),
				resolved_by: platform().user.norbital_id
			});
			resolutionDraft = { ...resolutionDraft, [logId]: '' };
		} catch (cause) {
			resolveFailure =
				cause instanceof Error ? cause.message : t('component.suspicion_resolve_failed');
		} finally {
			resolvingId = null;
		}
	};

	/** Whether anything is still waiting on a controller — what the accents below turn on. */
	const hasOpenSuspicion = $derived(suspicionRows.some((log) => log.resolved_at == null));

	const scopedEvidence = $derived(
		(directEvidenceQuery?.current ?? []).filter(
			(evidence) => record != null && evidence.job_assignment_id === record.norbital_id
		)
	);
	const evidenceAssetIds = $derived([
		...new Set(scopedEvidence.map((evidence) => evidence.document_asset_id))
	]);
	const evidenceAssetsQuery = $derived(
		evidenceAssetIds.length
			? client.db.document_asset.findMany({
					where: { norbital_id: { in: evidenceAssetIds } },
					limit: evidenceAssetIds.length
				})
			: null
	);
	const evidenceByAssetId = $derived(
		new Map(scopedEvidence.map((evidence) => [evidence.document_asset_id, evidence]))
	);
	const photoCards = $derived(
		(evidenceAssetsQuery?.current ?? []).flatMap((candidate) => {
			const parsed = decodeDocumentAsset(candidate);
			if (Option.isNone(parsed)) return [];
			const asset = parsed.value;
			const evidence = evidenceByAssetId.get(asset.norbital_id);
			if (!evidence) return [];
			return [
				{
					id: evidence.norbital_id,
					name: asset.file_name,
					fileSize: asset.file_size,
					url: `/api/files/${encodeURIComponent(asset.storage_key)}`,
					flags: (evidence.flags ?? []).filter((flag: unknown): flag is string => flag != null),
					source: evidenceSource(evidence.source),
					capturedAt: formatSingaporeInstant(evidence.norbital_created_at, t)
				}
			];
		})
	);
	const evidenceLoading = $derived(
		directEvidenceQuery?.loading === true ||
			(evidenceAssetIds.length > 0 && (evidenceAssetsQuery == null || evidenceAssetsQuery.loading))
	);
	/**
	 * Why this assignment warrants a look, kept as two distinct facts rather than one.
	 *
	 * `site_identity_mismatch` is a finding: a photographed identifier contradicts the assigned site.
	 * `site_identity_unverified` is the *absence* of a finding — the model's default, "fail closed
	 * until a linked photo visibly establishes a site identifier". Only the first was rendered, so a
	 * row nothing had ever checked was indistinguishable from one checked and found consistent: both
	 * showed no warning at all. Seeded rows are exactly that case, because the check runs from a
	 * `photo_evidence` created event and the seeder writes rows without emitting one — so every
	 * seeded assignment carries `unverified: true`, `checked_at: null`, and looked verified.
	 *
	 * An unverified state that renders as a verified one is worse than no check, because it answers
	 * the question it never asked.
	 */
	const suspicionReasons = $derived([
		...(hasOpenSuspicion
			? suspicionRows.filter((log) => log.resolved_at == null).map((log) => log.reason)
			: []),
		...(record?.site_identity_mismatch === true
			? [t('component.suspicion_site_identity_mismatch')]
			: []),
		...(record?.site_identity_mismatch !== true && record?.site_identity_unverified === true
			? [t('component.suspicion_site_identity_unverified')]
			: [])
	]);

	/**
	 * The photo the viewer opened, or nothing.
	 *
	 * A tile used to be an `<a href target="_blank">` straight at `/api/files/…`, which hands the
	 * browser the raw bytes and leaves the record behind — the reviewer loses the job they were
	 * checking the photograph against, which is the one thing they need beside it. An overlay keeps
	 * both and closes on Escape or a click outside.
	 */
	let openedPhoto = $state<(typeof photoCards)[number] | undefined>(undefined);

	function photoHasIntegritySignals(flags: string[]): boolean {
		return flags.length > 0;
	}

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
	{#snippet suspicionBanner()}
		{#if !isContractorViewer && (hasOpenSuspicion || record.site_identity_mismatch || record.site_identity_unverified)}
			<section
				class="border-s-2 border-orange-500 bg-orange-50/70 px-4 py-3 text-orange-950 dark:bg-orange-950/30 dark:text-orange-100"
				aria-labelledby="assignment-suspicion-heading"
			>
				<Inline align="start" gap="sm">
					<Icon icon="lucide:triangle-alert" class="size-5 shrink-0 text-orange-600" />
					<Stack gap="xs" class="min-w-0">
						<h3 id="assignment-suspicion-heading" class="text-sm font-semibold">
							{t('component.suspicious_evidence_title')}
						</h3>
						<p class="text-sm text-orange-900/80 dark:text-orange-100/80">
							{t('component.suspicious_evidence_description')}
						</p>
						{#if suspicionReasons.length > 0}
							<Stack as="ul" gap="xs" class="list-disc ps-5 text-sm">
								{#each suspicionReasons as reason (reason)}
									<li>{reason}</li>
								{/each}
							</Stack>
						{:else}
							<p class="text-sm">{t('component.suspicious_reason_pending')}</p>
						{/if}
						{#if record.site_identity_mismatch && record.site_identity_rationale}
							<p class="text-sm text-orange-900/80 dark:text-orange-100/80">
								<span class="font-medium">{t('component.agent_rationale')}:</span>
								{record.site_identity_rationale}
							</p>
						{/if}
					</Stack>
				</Inline>
			</section>
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
						<JobsRepresentation record={jobQuery.current[0]} close={() => undefined} {refresh} />
					{:else if jobQuery?.loading}
						<div
							class="h-32 rounded-md bg-muted/50 motion-safe:animate-pulse"
							aria-label={t('component.loading_job')}
						></div>
					{:else}
						<p class="text-sm text-destructive">{t('component.job_load_failed')}</p>
					{/if}
				</Cover>
				{@render suspicionBanner()}
			</Stack>
		</Scroll>
	{/snippet}

	{#snippet statusAndActivity()}
		<Scroll name={t('component.assignment_and_activity')}>
			<Stack gap="md">
				<CollectionForm {client} collection="job_assignments" defaultValues={record}>
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
								{#if isContractorViewer && record.status === 'suspect'}
									<Stack gap="xs">
										<span class="text-xs font-medium text-muted-foreground">
											{t('component.status')}
										</span>
										<span class="text-sm">{contractorProgressLabel()}</span>
									</Stack>
								{:else}
									<Field name="status" />
								{/if}
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
				{@render suspicionBanner()}
			</Stack>
		</Scroll>
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
					{#each variationsQuery?.current ?? [] as variation (variation.norbital_id)}
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
									instant: formatSingaporeInstant(variation.requested_at, t)
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
				{@render suspicionBanner()}
			</Stack>
		</Scroll>
	{/snippet}

	<!--
		The suspicions raised about this assignment, and the controller's answer to each.

		Resolving is writing a sentence, not clearing a flag. A log with an empty resolution and a log
		somebody looked at and judged fine are different facts, and a boolean cannot hold the
		difference — which is the same reason `site_identity_unverified` had to become visible rather
		than be treated as "no news".
	-->
	{#snippet suspicionLogs()}
		<Stack gap="md">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">{t('component.suspicion_logs')}</h3>
				<p class="text-tiny text-muted-foreground">{t('component.suspicion_logs_description')}</p>
			</Stack>
			{#if resolveFailure}
				<p class="text-tiny text-destructive" role="alert">{resolveFailure}</p>
			{/if}
			{#if suspicionQuery?.loading}
				<p class="text-tiny text-muted-foreground">{t('component.loading')}</p>
			{:else if suspicionRows.length === 0}
				<p class="text-tiny text-muted-foreground">{t('component.suspicion_logs_empty')}</p>
			{:else}
				<Stack gap="sm">
					{#each suspicionRows as log (log.norbital_id)}
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
								/>
								<span class="text-tiny font-semibold">
									{log.resolved_at == null
										? t('component.suspicion_open')
										: t('component.suspicion_resolved')}
								</span>
							</Inline>
							<p class="text-tiny">{log.reason}</p>
							{#if log.resolution}
								<p class="text-tiny text-muted-foreground">{log.resolution}</p>
							{:else}
								<!--
									The controller's answer, which is what closes the log.

									A free-text sentence and not a yes/no: "the unit number is 1 because the block
									entrance is numbered separately" and "the contractor was at the wrong address"
									are both resolutions and the difference is the entire value of the record.
								-->
								<Stack gap="xs">
									<Textarea
										rows={2}
										placeholder={t('component.suspicion_resolution_placeholder')}
										value={resolutionDraft[log.norbital_id] ?? ''}
										oninput={(event) =>
											(resolutionDraft = {
												...resolutionDraft,
												[log.norbital_id]: event.currentTarget.value
											})}
									/>
									<Inline gap="sm" align="center">
										<Button
											size="sm"
											disabled={(resolutionDraft[log.norbital_id] ?? '').trim() === '' ||
												resolvingId !== null}
											onclick={() => void resolveSuspicion(log.norbital_id)}
										>
											{resolvingId === log.norbital_id
												? t('component.suspicion_resolving')
												: t('component.suspicion_resolve')}
										</Button>
									</Inline>
								</Stack>
							{/if}
						</Stack>
					{/each}
				</Stack>
			{/if}
		</Stack>
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
				{#if directEvidenceQuery?.error || evidenceAssetsQuery?.error}
					<p
						class="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
						role="alert"
					>
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
											icon={isContractorViewer
												? 'lucide:image'
												: photoHasIntegritySignals(photo.flags)
													? 'lucide:scan-search'
													: 'lucide:image-check'}
											class={isContractorViewer
												? 'mt-0.5 size-4 shrink-0 text-muted-foreground'
												: photoHasIntegritySignals(photo.flags)
													? 'mt-0.5 size-4 shrink-0 text-muted-foreground'
													: 'mt-0.5 size-4 shrink-0 text-success'}
										/>
										<Stack gap="none" class="min-w-0">
											<p class="truncate text-sm font-medium">{photo.name}</p>
											<p class="text-meta">
												{photo.source} · {photo.capturedAt}
											</p>
										</Stack>
									</Inline>
									{#if !isContractorViewer}
										<Cluster justify="between" gap="xs" class="text-xs">
											<span class="text-muted-foreground">
												{photo.flags.length > 0
													? photo.flags.map(integrityFlagLabel).join(' · ')
													: t('component.integrity_passed')}
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
				{@render suspicionBanner()}
			</Stack>
		</Scroll>
	{/snippet}

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
			/**
			 * Suspicion logs, and only for somebody who can answer them.
			 *
			 * Spread rather than conditionally rendered inside the tab, because a tab that exists and
			 * refuses is still a tab: it tells a contractor a file about them is being kept. The policy
			 * is the real control — no contractor grant on `suspicious_activity_logs` exists — and this
			 * keeps the surface agreeing with it rather than relying on it alone.
			 */
			...(isContractorViewer
				? []
				: [
						{
							name: 'suspicions',
							label: t('component.suspicion_logs'),
							icon: 'lucide:shield-alert',
							content: suspicionLogs
						}
					])
		] satisfies TabConfig[]}
	/>
{:else}
	<CollectionForm
		{client}
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

					`bolt_auth_user` is granted to any authenticated subject masked to `norbital_id` and
					`name`; there is no workspace collection describing a contractor to point at, and the one
					that used to be here carried nothing this row does not.
				-->
				<Field
					name="assignee_user_id"
					label={t('component.contractor')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'bolt_auth_user',
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
