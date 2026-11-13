<script lang="ts">
	/**
	 * A job's review evidence for a controller: the integrity facts of its photos, the photos from other assignments
	 * the review showed the model beside its own (from the reviews' stored bases), and its findings, each open one
	 * closed by writing what was concluded. Embedded in a review's own evidence, `findings` leaves the findings out.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { FileRef, Id } from '@norbital-ai/bolt';
	import { EmptyState, enum_text, Form, format } from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { reviewCandidatesFrom } from './suspicion-evidence.js';
	import { isMessageKey } from './format.js';
	let {
		ctx,
		job,
		on_open,
		findings = true
	}: {
		ctx: PageContext;
		job: Id<'job_assignments'>;
		on_open: (photo: { name: string; url: string }) => void;
		findings?: boolean;
	} = $props();
	const t = ctx.t;
	const photos = $derived(
		ctx.query({
			photo_evidence: {
				where: { job_assignment_id: { eq: job } },
				fields: ['photo', 'flags'],
				limit: 250
			}
		})
	);
	const reviews = $derived(
		ctx.query({
			suspicion_reviews: {
				where: { job_assignment_id: { eq: job } },
				order_by: { reviewed_at: 'desc' },
				fields: ['basis'],
				limit: 100
			}
		})
	);
	const candidates = $derived(
		reviewCandidatesFrom((reviews.current?.suspicion_reviews.rows ?? []).map((r) => r.basis))
	);
	const others = $derived(
		candidates.length === 0
			? null
			: ctx.query({
					photo_evidence: {
						where: { id: { in: candidates.map((c) => c.id) } },
						fields: ['photo'],
						limit: 250,
						job_assignment_id: { fields: ['title'] }
					}
				})
	);
	const logs = $derived(
		!findings
			? null
			: ctx.query({
					suspicious_activity_logs: {
						where: { job_assignment_id: { eq: job } },
						order_by: 'created_at',
						fields: ['reason', 'resolution', 'resolved_at'],
						limit: 100
					}
				})
	);
	const view = (file: FileRef) => ({ name: file.name, url: ctx.file_url(file, { preview: 1024 }) });
	const flagged = $derived(
		(photos.current?.photo_evidence.rows ?? []).filter((p) => p.flags.length > 0)
	);
	const pairs = $derived(
		candidates.flatMap((candidate) => {
			const other = (others?.current?.photo_evidence.rows ?? []).find(
				(row) => row.id === candidate.id
			);
			return candidate.matchedPhotoIds.flatMap((own) => {
				const mine = (photos.current?.photo_evidence.rows ?? []).find((p) => p.id === own);
				return mine === undefined || other === undefined
					? []
					: [{ id: `${own}:${candidate.id}`, distance: candidate.distance, mine, other }];
			});
		})
	);
</script>

<Stack gap="md">
	{#if findings}<p class="text-tiny text-muted-foreground">
			{t('component.suspicion_logs_description')}
		</p>{/if}
	<Grid minimum="compact" gap="md">
		<section class="rounded-md border p-3" aria-label={t('component.evidence_facts')}>
			<h4 class="text-sm font-semibold">{t('component.evidence_facts')}</h4>
			<p class="text-tiny text-muted-foreground">{t('component.evidence_facts_description')}</p>
			{#if flagged.length === 0}<EmptyState
					variant="inset"
					title={t('component.evidence_facts_empty')}
				/>{/if}
			{#if flagged.length > 0}<Stack gap="sm" class="pt-2">
					{#each flagged as photo (photo.id)}
						<Inline
							as="button"
							type="button"
							class="w-full text-left"
							onclick={() => on_open(view(photo.photo))}
						>
							<img
								src={ctx.file_url(photo.photo, { preview: 1024 })}
								alt={photo.photo.name}
								class="size-14 rounded-md object-cover"
								loading="lazy"
							/>
							<span class="min-w-0">
								<span class="block truncate text-tiny font-medium">{photo.photo.name}</span>
								<Cluster gap="xs">
									{#each photo.flags as flag (flag)}
										<span class="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground"
											>{enum_text(flag, {
												t: (key) => (isMessageKey(key) ? ctx.t(key) : key),
												model: 'photo_evidence',
												field: 'flags'
											})}</span
										>
									{/each}
								</Cluster>
							</span>
						</Inline>
					{/each}
				</Stack>{/if}
		</section>
		<section
			class="rounded-md border p-3"
			aria-label={t('component.similar_photos_other_assignments')}
		>
			<h4 class="text-sm font-semibold">{t('component.similar_photos_other_assignments')}</h4>
			<p class="text-tiny text-muted-foreground">
				{t('component.similar_photos_other_assignments_description')}
			</p>
			{#if pairs.length === 0}<EmptyState
					variant="inset"
					title={t('component.similar_photos_other_assignments_empty')}
				/>{/if}
			{#if pairs.length > 0}<Stack gap="sm" class="pt-2">
					{#each pairs as pair (pair.id)}
						<article class="rounded-md border p-2">
							<p class="text-micro text-muted-foreground">
								{t('component.shown_to_review_agent')} · {t('component.similar_photo_distance', {
									distance: format({ kind: 'number' }, pair.distance, { locale: ctx.locale })
								})}
							</p>
							<Cluster gap="xs" align="center">
								<button type="button" onclick={() => on_open(view(pair.mine.photo))}>
									<img
										src={ctx.file_url(pair.mine.photo, { preview: 1024 })}
										alt={pair.mine.photo.name}
										class="h-14 w-20 rounded object-cover"
									/>
								</button>
								<Icon icon="lucide:arrow-left-right" class="size-3.5 text-muted-foreground" />
								<button type="button" onclick={() => on_open(view(pair.other.photo))}>
									<img
										src={ctx.file_url(pair.other.photo, { preview: 1024 })}
										alt={pair.other.photo.name}
										class="h-14 w-20 rounded object-cover"
									/>
								</button>
								<span class="text-micro text-muted-foreground">
									{pair.other.job_assignment_id?.title ??
										t('component.similar_photo_assignment_unavailable')}
								</span>
							</Cluster>
						</article>
					{/each}
				</Stack>{/if}
		</section>
	</Grid>
	{#if findings}<section aria-label={t('component.suspicion_judgements')}>
			<h4 class="text-sm font-semibold">{t('component.suspicion_judgements')}</h4>
			{#if logs?.error}<p class="text-tiny text-destructive" role="alert">
					{t('component.suspicion_load_failed')}
				</p>{/if}
			{#if logs?.current?.suspicious_activity_logs.rows.length === 0}<EmptyState
					variant="inset"
					title={t('component.suspicion_logs_empty')}
				/>{/if}
			<Stack gap="sm">
				{#each logs?.current?.suspicious_activity_logs.rows ?? [] as log (log.id)}
					<Stack
						gap="xs"
						class={log.resolved_at == null
							? 'rounded-md border border-warning/40 bg-warning/5 p-3'
							: 'rounded-md border p-3'}
					>
						<p class="text-tiny font-semibold">
							<Icon
								icon={log.resolved_at == null ? 'lucide:shield-alert' : 'lucide:shield-check'}
								class="inline size-4"
							/>
							{log.resolved_at == null
								? t('component.suspicion_open')
								: t('component.suspicion_resolved')}
						</p>
						<p class="text-tiny break-words">{log.reason}</p>
						{#if log.resolved_at != null}
							<p class="text-tiny text-muted-foreground">
								{log.resolution ?? t('component.suspicion_resolution_missing')}
							</p>
						{:else}
							<Form
								{ctx}
								of={{ automation: 'suspicious_activity_logs_resolve' }}
								values={{ finding: [log.id] }}
								fields={['resolution']}
								submit={t('component.suspicion_resolve')}
							/>
						{/if}
					</Stack>
				{/each}
			</Stack>
		</section>{/if}
</Stack>
