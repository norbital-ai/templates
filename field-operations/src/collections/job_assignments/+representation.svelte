<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { collectionClient } from '../../lib/collection-client.js';
	import { currentDate } from '../../lib/clock.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Cluster, Column, Cover, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { cn } from '@norbital-ai/ui/utils';
	import { Button } from '@norbital-ai/ui/button';
	import { Textarea } from '@norbital-ai/ui/textarea';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { formatFileSize } from '@norbital-ai/ui/utils';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import Icon from '@iconify/svelte';
	import { Effect, Option, Schema } from 'effect';
	import JobsRepresentation from '../jobs/+representation.svelte';
	import { formatSingaporeInstant } from '../../lib/format-singapore-instant.js';
	import { reviewCandidatesFrom } from './suspicion-evidence.js';

	let { record, close }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const dataRendererRuntime = getDataRendererRuntimeContext();
	if (dataRendererRuntime === undefined) {
		throw new Error('Field Operations requires the workspace file URL capability.');
	}

	const platform = getPlatformStateContext();

	/**
	 * Keep authored workspace code on the public capability surface. System access decisions stay
	 * inside Bolt's wiring; this representation only chooses its framing from the apps the shell
	 * already made visible. The collection policies remain the authority for every read and write.
	 *
	 * Both controller teams expose `field_ops_controller`; both controller and contractor teams
	 * expose `field_ops_contractor`. Those declarations are adjacent to the collection grants in the
	 * policies, so the controller-only review UI and the shared communication UI follow the same
	 * capability boundary without querying Bolt's private system API.
	 */
	const visibleApps = $derived(platform().apps);
	const mayReadSuspicion = $derived(visibleApps.includes('field_ops_controller'));
	const mayResolveSuspicion = $derived(visibleApps.includes('field_ops_controller'));
	const mayReadCommunication = $derived(visibleApps.includes('field_ops_contractor'));

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
	const communicationQuery = $derived(
		record != null && mayReadCommunication
			? client.db.communication_logs.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { sent_at: 'asc' },
					limit: 250
				})
			: null
	);
	const communicationRows = $derived(communicationQuery?.current ?? []);

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
	const suspicionReviewQuery = $derived(
		record != null && mayReadSuspicion
			? client.db.suspicion_reviews.findMany({
					where: { job_assignment_id: { eq: record.id } },
					orderBy: { reviewed_at: 'desc' },
					limit: 100
				})
			: null
	);
	const reviewCandidates = $derived(
		reviewCandidatesFrom((suspicionReviewQuery?.current ?? []).map((review) => review.basis))
	);
	const candidateEvidenceIds = $derived(reviewCandidates.map((candidate) => candidate.id));
	const candidateEvidenceQuery = $derived(
		candidateEvidenceIds.length > 0
			? client.db.photo_evidence.findMany({
					where: { id: { in: candidateEvidenceIds } },
					limit: 250
				})
			: null
	);
	const candidateAssignmentIds = $derived([
		...new Set(
			(candidateEvidenceQuery?.current ?? []).flatMap((evidence) =>
				evidence.job_assignment_id == null ? [] : [evidence.job_assignment_id]
			)
		)
	]);
	const candidateAssignmentQuery = $derived(
		candidateAssignmentIds.length > 0
			? client.db.job_assignments.findMany({
					where: { id: { in: candidateAssignmentIds } },
					limit: 250
				})
			: null
	);
	const openSuspicionRows = $derived(suspicionRows.filter((log) => log.resolved_at == null));
	const firstOpenSuspicion = $derived(openSuspicionRows[0]);
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
	const resolveSuspicion = (log: { readonly id: string }): void => {
		if (!canResolve(log)) return;
		const logId = log.id;
		const resolution = (resolutionDraft[logId] ?? '').trim();
		Effect.runFork(
			// The stamp is read through `Clock`, not the ambient constructor: the same workflow has to
			// mean the same thing under `TestClock`, and a resolution timestamp is part of what this
			// write asserts.
			Effect.flatMap(currentDate, (now) =>
				Effect.tryPromise({
					try: () =>
						client.db.suspicious_activity_logs.mutate([
							{
								id: logId,
								resolution,
								resolved_at: now.toISOString(),
								resolved_by: platform().user.id
							}
						]),
					catch: (cause) => cause
				})
			).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						// The live row now reads through the durable overlay. Retire the editor draft only
						// after that local commit; a later refusal is surfaced by the sync engine.
						const next = { ...resolutionDraft };
						delete next[logId];
						resolutionDraft = next;
					})
				),
				Effect.asVoid
			)
		);
	};

	/** Whether anything is still waiting on a controller — what the accents below turn on. */
	const hasOpenSuspicion = $derived(openSuspicionRows.length > 0);

	const scopedEvidence = $derived(
		(directEvidenceQuery?.current ?? []).filter(
			(evidence) => record != null && evidence.job_assignment_id === record.id
		)
	);

	type ChannelPhotoSource = {
		readonly provider: string;
		readonly messageId: string;
		readonly senderId: string;
		readonly sentAt: string | null;
	};

	function channelPhotoSource(source: unknown): ChannelPhotoSource | null {
		if (source == null || typeof source !== 'object' || Reflect.get(source, 'kind') !== 'channel') {
			return null;
		}
		const provider = Reflect.get(source, 'provider');
		const messageId = Reflect.get(source, 'message_id');
		const senderId = Reflect.get(source, 'sender_id');
		const sentAt = Reflect.get(source, 'sent_at');
		if (
			typeof provider !== 'string' ||
			typeof messageId !== 'string' ||
			typeof senderId !== 'string'
		) {
			return null;
		}
		return {
			provider,
			messageId,
			senderId,
			sentAt: typeof sentAt === 'string' ? sentAt : null
		};
	}
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
			const channelSource = channelPhotoSource(evidence.source);
			const source = evidenceSource(evidence.source);
			const sentAt = channelSource?.sentAt ?? evidence.created_at;
			return [
				{
					id: evidence.id,
					name: file.file_name,
					fileSize: file.file_size,
					url: dataRendererRuntime.fileUrl(file.storage_key),
					flags: (evidence.flags ?? []).filter((flag) => flag != null),
					sender: channelSource?.senderId ?? source,
					messageId: channelSource?.messageId ?? null,
					sentAt,
					system: channelSource == null
				}
			];
		})
	);
	const evidenceLoading = $derived(directEvidenceQuery?.loading === true);
	const communicationTimeline = $derived.by(() => {
		const photosByMessage = new Map<string, typeof photoCards>();
		for (const photo of photoCards) {
			if (photo.messageId == null) continue;
			photosByMessage.set(photo.messageId, [
				...(photosByMessage.get(photo.messageId) ?? []),
				photo
			]);
		}
		const attachedPhotoIds = new Set<string>();
		const messages = communicationRows.map((message) => {
			const photos = photosByMessage.get(message.source_message_id) ?? [];
			for (const photo of photos) attachedPhotoIds.add(photo.id);
			return {
				id: `message:${message.source_message_id}`,
				sender: message.sender,
				text: message.message,
				sentAt: message.sent_at,
				photos,
				system: false
			};
		});
		const standalonePhotos = photoCards
			.filter((photo) => !attachedPhotoIds.has(photo.id))
			.map((photo) => ({
				id: `photo:${photo.id}`,
				sender: photo.sender,
				text: null,
				sentAt: photo.sentAt,
				photos: [photo],
				system: photo.system
			}));
		const ordered = [...messages, ...standalonePhotos].sort(
			(left, right) => timelineTimestamp(left.sentAt) - timelineTimestamp(right.sentAt)
		);
		const grouped: typeof ordered = [];
		for (const item of ordered) {
			const previous = grouped.at(-1);
			const photoBurst =
				previous !== undefined &&
				item.text == null &&
				!item.system &&
				previous.text == null &&
				previous.system === false &&
				previous.sender === item.sender &&
				timelineDayKey(previous.sentAt) === timelineDayKey(item.sentAt) &&
				Math.abs(timelineTimestamp(item.sentAt) - timelineTimestamp(previous.sentAt)) <= 120_000;
			if (photoBurst && previous) {
				previous.photos.push(...item.photos);
				continue;
			}
			grouped.push({ ...item, photos: [...item.photos] });
		}
		return grouped;
	});
	const evidenceFactCards = $derived(
		photoCards.flatMap((photo) => {
			const facts = [...new Set(photo.flags.map(integrityFlagLabel))];
			return facts.length === 0 ? [] : [{ ...photo, facts }];
		})
	);
	const similarPhotoPairs = $derived(
		reviewCandidates.flatMap((candidate) => {
			const candidateEvidence = (candidateEvidenceQuery?.current ?? []).find(
				(evidence) => evidence.id === candidate.id
			);
			const parsedCandidate =
				candidateEvidence === undefined ? Option.none() : decodePhotoFile(candidateEvidence.photo);
			const candidateName = Option.isSome(parsedCandidate)
				? parsedCandidate.value.file_name
				: (candidate.storageKey.split('/').at(-1) ?? t('component.photo'));
			const candidateUrl = dataRendererRuntime.fileUrl(
				Option.isSome(parsedCandidate) ? parsedCandidate.value.storage_key : candidate.storageKey
			);
			const assignment = (candidateAssignmentQuery?.current ?? []).find(
				(row) => row.id === candidateEvidence?.job_assignment_id
			);
			return candidate.matchedPhotoIds.flatMap((matchedPhotoId) => {
				const submitted = photoCards.find((photo) => photo.id === matchedPhotoId);
				return submitted === undefined
					? []
					: [
							{
								id: `${submitted.id}:${candidate.id}`,
								distance: candidate.distance,
								submitted,
								candidate: { name: candidateName, url: candidateUrl },
								assignment:
									assignment?.search_text ?? t('component.similar_photo_assignment_unavailable')
							}
						];
			});
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
	let openedPhoto = $state<{ readonly name: string; readonly url: string } | undefined>(undefined);
	let conversationPort = $state<HTMLElement | null>(null);
	let conversationPinnedToLatest = $state(true);
	let conversationAwayFromLatest = $state(false);

	function syncConversationScroll(): void {
		if (conversationPort == null) return;
		const distanceFromLatest =
			conversationPort.scrollHeight - conversationPort.scrollTop - conversationPort.clientHeight;
		conversationPinnedToLatest = distanceFromLatest <= 24;
		conversationAwayFromLatest = conversationPort.scrollTop > 24 || !conversationPinnedToLatest;
	}

	function scrollConversationToLatest(): void {
		if (conversationPort == null) return;
		conversationPort.scrollTo({ top: conversationPort.scrollHeight });
		conversationPinnedToLatest = true;
		conversationAwayFromLatest = false;
	}

	$effect(() => {
		communicationTimeline;
		const port = conversationPort;
		if (port == null || !conversationPinnedToLatest) return;
		queueMicrotask(() => {
			port.scrollTo({ top: port.scrollHeight });
		});
	});

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
		const channelSource = channelPhotoSource(source);
		return channelSource == null
			? t('component.workspace_upload')
			: t('component.provider_agent', { provider: channelSource.provider });
	}

	function timelineTimestamp(value: string | null | undefined): number {
		if (value == null) return 0;
		const timestamp = new Date(value).getTime();
		return Number.isNaN(timestamp) ? 0 : timestamp;
	}

	function timelineDayKey(value: string | null | undefined): string {
		const timestamp = timelineTimestamp(value);
		if (timestamp === 0) return 'unknown';
		return new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			timeZone: 'Asia/Singapore'
		}).format(new Date(timestamp));
	}

	function formatTimelineDay(value: string | null | undefined): string {
		const timestamp = timelineTimestamp(value);
		if (timestamp === 0) return t('component.not_recorded');
		return new Intl.DateTimeFormat('en-SG', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Singapore'
		}).format(new Date(timestamp));
	}

	function formatTimelineTime(value: string | null | undefined): string {
		const timestamp = timelineTimestamp(value);
		if (timestamp === 0) return t('component.not_recorded');
		return new Intl.DateTimeFormat('en-SG', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'Asia/Singapore'
		}).format(new Date(timestamp));
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
		<CollectionForm client={collectionClient} collection="job_assignments" defaultValues={record}>
			{#snippet children({ Field })}
				<Field name="job_id" hidden />
				<Field name="assignee_user_id" hidden />
				<Field name="source_message_id" hidden />
				<Field name="suspicion_checked_at" hidden />
				<!--
					Hook-owned, like the two above it. `search_text` is the job title copied onto the
					assignment so the board can search the words an operator can actually see; `+hooks.ts`
					derives it and strips it back out of every update, so there is nothing here for anyone
					to edit. It is still a mutable column, so the form has to name it or refuse to render.
				-->
				<Field name="search_text" hidden />
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
		<Scroll name={t('component.suspicion_logs')}>
			<Stack gap="md">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">{t('component.suspicion_logs')}</h3>
					<p class="text-tiny text-muted-foreground">
						{t('component.suspicion_logs_description')}
					</p>
				</Stack>

				<Grid minimum="compact" gap="md">
					<section
						aria-labelledby="assignment-evidence-facts-heading"
						class="min-w-0 rounded-md border border-border bg-card p-3"
					>
						<Stack gap="sm">
							<Stack gap="xs">
								<Inline justify="between" align="center" gap="sm">
									<h4 id="assignment-evidence-facts-heading" class="text-sm font-semibold">
										{t('component.evidence_facts')}
									</h4>
									<span class="shrink-0 text-micro tabular-nums text-muted-foreground">
										{t('component.recorded_count', { count: evidenceFactCards.length })}
									</span>
								</Inline>
								<p class="text-tiny text-muted-foreground">
									{t('component.evidence_facts_description')}
								</p>
							</Stack>
							<div class="h-52 min-h-0">
								<Scroll name={t('component.evidence_facts')} layout="stack" gap="xs">
									{#if evidenceLoading}
										<p class="text-tiny text-muted-foreground">
											{t('component.loading_evidence')}
										</p>
									{:else if directEvidenceQuery?.error}
										<p class="text-tiny text-destructive" role="alert">
											{t('component.evidence_load_failed')}
										</p>
									{:else if evidenceFactCards.length === 0}
										<p class="text-tiny text-muted-foreground">
											{t('component.evidence_facts_empty')}
										</p>
									{:else}
										{#each evidenceFactCards as photo (photo.id)}
											<Inline
												as="article"
												align="stretch"
												class="rounded-md border border-border bg-background p-2"
											>
												<button
													type="button"
													class="size-14 shrink-0 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													aria-label={t('component.open_photo', { name: photo.name })}
													onclick={() => (openedPhoto = photo)}
												>
													<img
														src={photo.url}
														alt={photo.name}
														class="size-full object-cover"
														loading="lazy"
														decoding="async"
													/>
												</button>
												<Stack gap="xs" class="min-w-0 py-0.5">
													<p class="truncate text-tiny font-medium">{photo.name}</p>
													<Cluster gap="xs">
														{#each photo.facts as fact (fact)}
															<span
																class="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground"
																>{fact}</span
															>
														{/each}
													</Cluster>
												</Stack>
											</Inline>
										{/each}
									{/if}
								</Scroll>
							</div>
						</Stack>
					</section>

					<section
						aria-labelledby="assignment-similar-photos-heading"
						class="min-w-0 rounded-md border border-border bg-card p-3"
					>
						<Stack gap="sm">
							<Stack gap="xs">
								<Inline justify="between" align="center" gap="sm">
									<Inline align="center" gap="xs" class="min-w-0">
										<Icon
											icon="lucide:images"
											class="size-4 shrink-0 text-muted-foreground"
											aria-hidden="true"
										/>
										<h4
											id="assignment-similar-photos-heading"
											class="min-w-0 text-sm font-semibold"
										>
											{t('component.similar_photos_other_assignments')}
										</h4>
									</Inline>
									<span class="shrink-0 text-micro tabular-nums text-muted-foreground">
										{t('component.recorded_count', { count: similarPhotoPairs.length })}
									</span>
								</Inline>
								<p class="text-tiny text-muted-foreground">
									{t('component.similar_photos_other_assignments_description')}
								</p>
							</Stack>
							<div class="h-52 min-h-0">
								<Scroll
									name={t('component.similar_photos_other_assignments')}
									layout="stack"
									gap="xs"
								>
									{#if suspicionReviewQuery?.loading || candidateEvidenceQuery?.loading || candidateAssignmentQuery?.loading}
										<p class="text-tiny text-muted-foreground">
											{t('component.loading_evidence')}
										</p>
									{:else if suspicionReviewQuery?.error || candidateEvidenceQuery?.error || candidateAssignmentQuery?.error}
										<p class="text-tiny text-destructive" role="alert">
											{t('component.evidence_load_failed')}
										</p>
									{:else if similarPhotoPairs.length === 0}
										<p class="text-tiny text-muted-foreground">
											{t('component.similar_photos_other_assignments_empty')}
										</p>
									{:else}
										{#each similarPhotoPairs as pair (pair.id)}
											<article class="rounded-md border border-border bg-background p-2">
												<Stack gap="xs">
													<Inline justify="between" align="center" gap="sm">
														<span
															class="truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground"
														>
															{t('component.shown_to_review_agent')}
														</span>
														<span class="shrink-0 text-micro tabular-nums text-muted-foreground">
															{t('component.similar_photo_distance', {
																distance: pair.distance.toFixed(3)
															})}
														</span>
													</Inline>
													<Grid
														tracks="minmax(0, 1fr) auto minmax(0, 1fr)"
														gap="xs"
														class="items-center"
													>
														<button
															type="button"
															class="min-w-0 rounded-md bg-muted/45 p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
															onclick={() => (openedPhoto = pair.submitted)}
														>
															<img
																src={pair.submitted.url}
																alt={pair.submitted.name}
																class="h-14 w-full rounded object-cover"
																loading="lazy"
																decoding="async"
															/>
															<span class="mt-1 block truncate text-micro font-medium">
																{pair.submitted.name}
															</span>
														</button>
														<Icon
															icon="lucide:arrow-left-right"
															class="size-3.5 text-muted-foreground"
															aria-hidden="true"
														/>
														<button
															type="button"
															class="min-w-0 rounded-md bg-warning/5 p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
															onclick={() => (openedPhoto = pair.candidate)}
														>
															<img
																src={pair.candidate.url}
																alt={pair.candidate.name}
																class="h-14 w-full rounded object-cover"
																loading="lazy"
																decoding="async"
															/>
															<span class="mt-1 block truncate text-micro font-medium">
																{pair.candidate.name}
															</span>
															<span class="block truncate text-micro text-muted-foreground">
																{pair.assignment}
															</span>
														</button>
													</Grid>
												</Stack>
											</article>
										{/each}
									{/if}
								</Scroll>
							</div>
						</Stack>
					</section>
				</Grid>

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
												icon={log.resolved_at == null
													? 'lucide:shield-alert'
													: 'lucide:shield-check'}
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
		</Scroll>
	{/snippet}

	{#snippet assignmentConversation()}
		<Scroll name={t('component.conversation')}>
			<Stack as="section" aria-labelledby="assignment-conversation-heading" gap="md">
				<Inline justify="between" align="start" gap="sm">
					<div>
						<h4 id="assignment-conversation-heading" class="text-sm font-semibold">
							{t('component.conversation')}
						</h4>
						<p class="text-meta">{t('component.conversation_description')}</p>
					</div>
					<Inline
						align="center"
						gap="xs"
						class="shrink-0 rounded-full bg-muted px-2.5 py-1 text-micro text-muted-foreground"
					>
						<Icon icon="lucide:lock-keyhole" class="size-3" aria-hidden="true" />
						<span>{t('component.conversation_read_only')}</span>
					</Inline>
				</Inline>

				{#if communicationQuery?.error}
					<p class="text-sm text-destructive" role="alert">
						{t('component.communication_logs_failed')}
					</p>
				{/if}
				{#if directEvidenceQuery?.error}
					<p class="text-sm text-destructive" role="alert">
						{t('component.evidence_load_failed')}
					</p>
				{/if}

				<div class="relative min-h-80">
					<Scroll
						bind:ref={conversationPort}
						name={t('component.conversation')}
						class="min-h-80 max-h-[28rem] rounded-lg border border-border bg-muted/25 p-3"
						onscroll={syncConversationScroll}
					>
						{#if communicationTimeline.length === 0 && (communicationQuery?.loading || evidenceLoading)}
							<Stack gap="sm" aria-label={t('component.loading')}>
								<div
									class="h-16 w-3/4 rounded-e-xl rounded-bl-xl bg-muted motion-safe:animate-pulse"
								></div>
								<div
									class="h-24 w-2/3 rounded-e-xl rounded-bl-xl bg-muted motion-safe:animate-pulse"
								></div>
								<div
									class="h-14 w-4/5 rounded-e-xl rounded-bl-xl bg-muted motion-safe:animate-pulse"
								></div>
							</Stack>
						{:else if communicationTimeline.length === 0}
							<div
								class="rounded-md border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground"
							>
								{t('component.conversation_empty')}
							</div>
						{:else}
							<Stack as="ol" gap="sm">
								{#each communicationTimeline as item, index (item.id)}
									{@const dayKey = timelineDayKey(item.sentAt)}
									{#if index === 0 || dayKey !== timelineDayKey(communicationTimeline[index - 1]?.sentAt)}
										<li class="flex justify-center py-1">
											<span
												class="rounded-full bg-background px-2.5 py-1 text-micro font-medium text-muted-foreground"
											>
												{formatTimelineDay(item.sentAt)}
											</span>
										</li>
									{/if}
									{@const recordedFlags = [
										...new Set(item.photos.flatMap((photo) => photo.flags.map(integrityFlagLabel)))
									]}
									<li class={item.system ? 'flex justify-center' : 'flex justify-start'}>
										<article
											class={cn(
												'min-w-0 px-2.5 py-2',
												item.system
													? 'w-full max-w-sm rounded-lg bg-muted'
													: 'w-fit max-w-[min(100%,32rem)] rounded-e-xl rounded-bl-xl rounded-tl-sm border border-border bg-card'
											)}
										>
											<Stack gap="xs">
												<Inline align="center" gap="xs" class="min-w-0">
													<Icon
														icon={item.system ? 'lucide:upload' : 'lucide:user-round'}
														class="size-3.5 shrink-0 text-muted-foreground"
														aria-hidden="true"
													/>
													<span class="min-w-0 truncate text-tiny font-semibold">{item.sender}</span
													>
												</Inline>
												{#if item.text}
													<p
														class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
													>
														{item.text}
													</p>
												{/if}
												{#if item.photos.length > 0}
													{#if item.photos.length > 1}
														<p class="text-micro font-medium text-muted-foreground">
															{t('component.photo_count', { count: item.photos.length })}
														</p>
													{/if}
													<div
														class={cn(
															'grid min-w-0 gap-1.5 overflow-hidden rounded-md',
															item.photos.length > 1 && 'grid-cols-2',
															item.photos.length > 4 && 'grid-cols-3'
														)}
													>
														{#each item.photos as photo (photo.id)}
															<button
																type="button"
																onclick={() => (openedPhoto = photo)}
																class="group min-w-0 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
																aria-label={t('component.open_photo', { name: photo.name })}
																title={photo.name}
															>
																<img
																	src={photo.url}
																	alt={photo.name}
																	class={cn(
																		'w-full object-cover transition-opacity duration-150 group-hover:opacity-90',
																		item.photos.length === 1
																			? 'h-28'
																			: item.photos.length > 6
																				? 'h-16'
																				: 'h-20'
																	)}
																	loading="lazy"
																	decoding="async"
																/>
															</button>
														{/each}
													</div>
												{/if}
												{#if mayReadSuspicion && recordedFlags.length > 0}
													<Inline align="start" gap="xs" class="text-micro text-muted-foreground">
														<Icon
															icon="lucide:scan-search"
															class="mt-0.5 size-3 shrink-0"
															aria-hidden="true"
														/>
														<span class="break-words [overflow-wrap:anywhere]">
															{recordedFlags.join(' · ')}
														</span>
													</Inline>
												{/if}
												<Inline
													justify="end"
													gap="xs"
													class="text-micro tabular-nums text-muted-foreground"
												>
													{#if item.photos.length === 1 && item.photos[0]?.fileSize != null}
														<span>{formatFileSize(item.photos[0].fileSize)}</span>
														<span aria-hidden="true">·</span>
													{/if}
													<time datetime={item.sentAt ?? undefined}
														>{formatTimelineTime(item.sentAt)}</time
													>
												</Inline>
											</Stack>
										</article>
									</li>
								{/each}
							</Stack>
						{/if}
					</Scroll>
					{#if conversationAwayFromLatest && communicationTimeline.length > 0}
						<div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
							<Button
								size="sm"
								variant="secondary"
								class="pointer-events-auto shadow-sm"
								onclick={scrollConversationToLatest}
							>
								<Icon icon="lucide:arrow-down" class="size-3.5 shrink-0" />
								{t('component.conversation_to_latest')}
							</Button>
						</div>
					{/if}
				</div>
			</Stack>
		</Scroll>
	{/snippet}

	<Cover gap="sm" top={suspicionHeader}>
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
					name: 'conversation',
					label: t('component.conversation'),
					icon: 'lucide:messages-square',
					content: assignmentConversation
				},
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
	</Cover>
{:else}
	<CollectionForm
		client={collectionClient}
		collection="job_assignments"
		submitLabel={t('component.create_assignment')}
		onAfterSubmit={close}
	>
		{#snippet children({ Field })}
			<Field name="dispatched_at" hidden />
			<Field name="status" hidden />
			<Field name="completed_at" hidden />
			<Field name="amount_charged" hidden />
			<Field name="location" hidden />
			<Field name="summary" hidden />
			<Field name="source_message_id" hidden />
			<Field name="suspicion_checked_at" hidden />
			<!-- Derived from the chosen job by `+hooks.ts` on create; never authored here. -->
			<Field name="search_text" hidden />
			<Grid minimum="panel">
				<Field
					name="job_id"
					label={t('component.job')}
					relationOptions={{
						label: (record) => {
							const v = record.title;
							return v != null && v !== '' ? String(v) : '—';
						},
						orderBy: { title: 'asc' },
						limit: 500
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
					relationOptions={{
						label: (record) => {
							const v = record.name;
							return v != null && v !== '' ? String(v) : '—';
						},
						orderBy: { name: 'asc' },
						limit: 500
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
