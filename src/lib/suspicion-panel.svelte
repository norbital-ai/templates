<script lang="ts">
	/**
	 * A job's review evidence for a controller: the integrity facts of its photos, the photos from other assignments
	 * the review showed the model beside its own (from the reviews' stored bases), and its findings, each open one
	 * closed by writing what was concluded.
	 */
	import { bolt } from '$bolt';
	import type { FileRef, Id } from '@norbital-ai/bolt';
	import { Form } from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { live } from './live.svelte.js';
	import { reviewCandidatesFrom } from './suspicion-evidence.js';

	let {
		job,
		onOpen
	}: { job: Id<'job_assignments'>; onOpen: (photo: { name: string; url: string }) => void } =
		$props();
	const t = bolt.t;
	const photos = live(() =>
		bolt.read('photo_evidence', {
			where: { job_assignment_id: { eq: job } },
			select: { photo: true, flags: true },
			limit: 250
		})
	);
	const reviews = live(() =>
		bolt.read('suspicion_reviews', {
			where: { job_assignment_id: { eq: job } },
			orderBy: { reviewed_at: 'desc' },
			select: { basis: true },
			limit: 100
		})
	);
	const candidates = $derived(
		reviewCandidatesFrom((reviews.current?.rows ?? []).map((r) => r.basis))
	);
	const others = live(() =>
		candidates.length === 0
			? null
			: bolt.read('photo_evidence', {
					where: { id: { in: candidates.map((c) => c.id) } },
					select: { photo: true, job_assignment_id: { select: { title: true } } },
					limit: 250
				})
	);
	const logs = live(() =>
		bolt.read('suspicious_activity_logs', {
			where: { job_assignment_id: { eq: job } },
			orderBy: 'created_at',
			select: { reason: true, resolution: true, resolved_at: true },
			limit: 100
		})
	);
	const view = (file: FileRef) => ({ name: file.name, url: bolt.fileUrl(file) });
	const flagged = $derived((photos.current?.rows ?? []).filter((p) => p.flags.length > 0));
	const pairs = $derived(
		candidates.flatMap((candidate) => {
			const other = (others.current?.rows ?? []).find((row) => row.id === candidate.id);
			return candidate.matchedPhotoIds.flatMap((own) => {
				const mine = (photos.current?.rows ?? []).find((p) => p.id === own);
				return mine === undefined || other === undefined
					? []
					: [{ id: `${own}:${candidate.id}`, distance: candidate.distance, mine, other }];
			});
		})
	);
</script>

<Stack gap="md">
	<p class="text-tiny text-muted-foreground">{t('component.suspicion_logs_description')}</p>
	<Grid minimum="compact" gap="md">
		<section class="rounded-md border p-3" aria-label={t('component.evidence_facts')}>
			<h4 class="text-sm font-semibold">{t('component.evidence_facts')}</h4>
			<p class="text-tiny text-muted-foreground">{t('component.evidence_facts_description')}</p>
			{#if flagged.length === 0}<p class="text-tiny text-muted-foreground">
					{t('component.evidence_facts_empty')}
				</p>{/if}
			{#if flagged.length > 0}<Stack gap="sm" class="pt-2">
					{#each flagged as photo (photo.id)}
						<Inline
							as="button"
							type="button"
							class="w-full text-left"
							onclick={() => onOpen(view(photo.photo))}
						>
							<img
								src={bolt.fileUrl(photo.photo)}
								alt={photo.photo.name}
								class="size-14 rounded-md object-cover"
								loading="lazy"
							/>
							<span class="min-w-0">
								<span class="block truncate text-tiny font-medium">{photo.photo.name}</span>
								<Cluster gap="xs">
									{#each photo.flags as flag (flag)}
										<span class="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground"
											>{t(`component.flag_${flag}`)}</span
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
			{#if pairs.length === 0}<p class="text-tiny text-muted-foreground">
					{t('component.similar_photos_other_assignments_empty')}
				</p>{/if}
			{#if pairs.length > 0}<Stack gap="sm" class="pt-2">
					{#each pairs as pair (pair.id)}
						<article class="rounded-md border p-2">
							<p class="text-micro text-muted-foreground">
								{t('component.shown_to_review_agent')} · {t('component.similar_photo_distance', {
									distance: pair.distance.toFixed(3)
								})}
							</p>
							<Cluster gap="xs" align="center">
								<button type="button" onclick={() => onOpen(view(pair.mine.photo))}>
									<img
										src={bolt.fileUrl(pair.mine.photo)}
										alt={pair.mine.photo.name}
										class="h-14 w-20 rounded object-cover"
									/>
								</button>
								<Icon icon="lucide:arrow-left-right" class="size-3.5 text-muted-foreground" />
								<button type="button" onclick={() => onOpen(view(pair.other.photo))}>
									<img
										src={bolt.fileUrl(pair.other.photo)}
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
	<section aria-label={t('component.suspicion_judgements')}>
		<h4 class="text-sm font-semibold">{t('component.suspicion_judgements')}</h4>
		{#if logs.error}<p class="text-tiny text-destructive" role="alert">
				{t('component.suspicion_load_failed')}
			</p>{/if}
		{#if (logs.current?.rows ?? []).length === 0}<p class="text-tiny text-muted-foreground">
				{t('component.suspicion_logs_empty')}
			</p>{/if}
		<Stack gap="sm">
			{#each logs.current?.rows ?? [] as log (log.id)}
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
							of={{ action: 'suspicious_activity_logs.resolve' }}
							id={log.id}
							submit={t('component.suspicion_resolve')}
						/>
					{/if}
				</Stack>
			{/each}
		</Stack>
	</section>
</Stack>
