<script lang="ts">
	import { client } from '$pod/client';
	import { getPlatformStateContext } from '@norbital-ai/pod/client';
	import { useI18n, type I18nApi } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
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
	import { formatFileSize } from '@norbital-ai/ui/utils';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import Icon from '@iconify/svelte';
	import { z } from 'zod';
	import JobsRepresentation from '../jobs/+representation.svelte';

	let { record, close, refresh }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * Flag visibility is reserved for the controller dashboard. Contractors see their evidence photos
	 * but never the integrity results, so the shared assignment sheet hides them from a viewer who
	 * has a contractor profile (the same lookup the contractor app uses to identify its own viewer).
	 */
	const viewerUser = getPlatformStateContext()().user;
	const viewerContractorQuery = client.db.contractor_profiles.findMany({
		where: { user_id: { eq: viewerUser.norbital_id } },
		limit: 1
	});
	const isContractorViewer = $derived(viewerContractorQuery.current?.[0] != null);

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

	const documentAssetSchema = z.object({
		norbital_id: z.string().uuid(),
		file_name: z.string(),
		file_size: z.number().nullable().optional(),
		storage_key: z.string()
	});

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
			const parsed = documentAssetSchema.safeParse(candidate);
			if (!parsed.success) return [];
			const evidence = evidenceByAssetId.get(parsed.data.norbital_id);
			if (!evidence) return [];
			return [
				{
					id: evidence.norbital_id,
					name: parsed.data.file_name,
					fileSize: parsed.data.file_size,
					url: `/api/files/download/${encodeURIComponent(parsed.data.storage_key)}`,
					flags: (evidence.flags ?? []).filter((flag): flag is string => flag != null),
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
	const assignmentIntegrityFlags = $derived([
		...new Set(scopedEvidence.flatMap((evidence) => evidence.flags ?? []))
	]);
	const hasGeotaggedPhoto = $derived(
		scopedEvidence.some((evidence) => !evidence.flags.includes('missing_geolocation'))
	);
	const missingBothLocationSignals = $derived(
		record?.status === 'suspect' && !hasGeotaggedPhoto && record.site_identity_unverified === true
	);
	const suspicionReasons = $derived([
		...(assignmentIntegrityFlags.includes('exact_duplicate')
			? [t('component.suspicion_exact_duplicate')]
			: []),
		...(assignmentIntegrityFlags.includes('visual_duplicate')
			? [t('component.suspicion_visual_duplicate')]
			: []),
		...(missingBothLocationSignals ? [t('component.suspicion_location_evidence_missing')] : [])
	]);

	function photoHasHardSuspicion(flags: string[]): boolean {
		return flags.includes('exact_duplicate') || flags.includes('visual_duplicate');
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
	{#if !isContractorViewer && (record.status === 'suspect' || suspicionReasons.length > 0)}
		<Stack gap="none" class="pb-4">
			<section
				class="border-s-2 border-orange-500 bg-orange-50/70 px-4 py-3 text-orange-950 dark:bg-orange-950/30 dark:text-orange-100"
				aria-labelledby="assignment-suspicion-heading"
			>
				<Inline align="start" gap="sm">
					<Icon icon="lucide:triangle-alert" class="mt-0.5 size-5 shrink-0 text-orange-600" />
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
					</Stack>
				</Inline>
			</section>
		</Stack>
	{/if}
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
		<Cover gap="md" top={jobScopeHeader}>
			{#if jobQuery?.current?.[0]}
				<JobsRepresentation record={jobQuery.current[0]} close={() => undefined} {refresh} />
			{:else if jobQuery?.loading}
				<div
					class="h-32 rounded-md bg-muted/50 motion-safe:animate-pulse"
					aria-label={t('component.loading_job')}
				></div>
			{:else}
				<Scroll name={t('component.job_scope_status')}>
					<p class="text-sm text-destructive">{t('component.job_load_failed')}</p>
				</Scroll>
			{/if}
		</Cover>
	{/snippet}

	{#snippet statusAndActivity()}
		<CollectionForm
			{client}
			collection="job_assignments"
			recordId={record.norbital_id}
			defaultValues={record}
		>
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
	{/snippet}

	{#snippet variationHistory()}
		<Scroll name={t('component.variation_history')}>
			<Stack as="section" aria-labelledby="variation-history-heading" gap="md">
				<Inline justify="between" gap="sm">
					<div>
						<h4 id="variation-history-heading" class="text-sm font-semibold">
							{t('component.variations')}
						</h4>
						<p class="text-xs text-muted-foreground">{t('component.variations_description')}</p>
					</div>
					<span class="text-xs tabular-nums text-muted-foreground">
						{t('component.recorded_count', { count: variationsQuery?.current?.length ?? 0 })}
					</span>
				</Inline>
				<Stack gap="sm">
					{#each variationsQuery?.current ?? [] as variation (variation.norbital_id)}
						<Stack as="section" gap="sm" class="rounded-md border border-border bg-card p-3">
							<Inline align="start" justify="between" gap="sm">
								<div>
									<p class="text-sm font-medium">{variation.title}</p>
									<p class="mt-1 text-sm text-muted-foreground">{variation.description}</p>
								</div>
								<span class="shrink-0 text-sm font-medium">{formatMoney(variation.amount)}</span>
							</Inline>
							<p class="text-xs text-muted-foreground">
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
			</Stack>
		</Scroll>
	{/snippet}

	{#snippet photoGallery()}
		<Scroll name={t('component.assignment_evidence')}>
			<Stack as="section" aria-labelledby="evidence-heading" gap="md">
				<Inline justify="between" gap="sm">
					<div>
						<h4 id="evidence-heading" class="text-sm font-semibold">{t('component.evidence')}</h4>
						<p class="text-xs text-muted-foreground">{t('component.evidence_description')}</p>
					</div>
					<span class="text-xs tabular-nums text-muted-foreground">
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
							<figure
								class={photoHasHardSuspicion(photo.flags) && !isContractorViewer
									? 'min-w-0 rounded-md border border-orange-500 bg-card'
									: 'min-w-0 rounded-md border border-border bg-card'}
							>
								<a
									href={photo.url}
									target="_blank"
									rel="noreferrer"
									class="group block bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
									aria-label={t('component.open_photo', { name: photo.name })}
								>
									<Frame ratio="landscape">
										<img
											src={photo.url}
											alt={photo.name}
											class="transition-opacity duration-150 group-hover:opacity-90"
											loading="lazy"
										/>
									</Frame>
								</a>
								<Stack as="section" gap="sm" class="p-3">
									<Inline align="start" gap="xs">
										<Icon
											icon={isContractorViewer
												? 'lucide:image'
												: photoHasHardSuspicion(photo.flags)
													? 'lucide:scan-warning'
													: photo.flags.length > 0
														? 'lucide:map-pin-off'
														: 'lucide:image-check'}
											class={isContractorViewer
												? 'mt-0.5 size-4 shrink-0 text-muted-foreground'
												: photoHasHardSuspicion(photo.flags)
													? 'mt-0.5 size-4 shrink-0 text-destructive'
													: photo.flags.length > 0
														? 'mt-0.5 size-4 shrink-0 text-muted-foreground'
														: 'mt-0.5 size-4 shrink-0 text-success'}
										/>
										<Stack gap="none" class="min-w-0">
											<p class="truncate text-sm font-medium">{photo.name}</p>
											<p class="text-xs text-muted-foreground">
												{photo.source} · {photo.capturedAt}
											</p>
										</Stack>
									</Inline>
									{#if !isContractorViewer}
										<Cluster justify="between" gap="xs" class="text-xs">
											<span
												class={photoHasHardSuspicion(photo.flags)
													? 'text-destructive'
													: 'text-muted-foreground'}
											>
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
											<p class="text-xs tabular-nums text-muted-foreground">
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
			}
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
				<Field
					name="contractor_profile_id"
					label={t('component.contractor')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'contractor_profiles',
						options: {
							label: (record) => {
								const v = record.company_name;
								return v != null && v !== '' ? String(v) : '—';
							},
							orderBy: { company_name: 'asc' },
							limit: 500
						}
					}}
				/>
			</Grid>
		{/snippet}
	</CollectionForm>
{/if}
