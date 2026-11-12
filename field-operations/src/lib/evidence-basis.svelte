<script lang="ts">
	/**
	 * What a review judged, as a controller reads it: the job and site it named, the closest photo matches it was
	 * shown, the job's photos and its conversation. Identifiers and file hashes stay out of sight.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { enum_text, Section, Show, Table } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import Conversation from './conversation.svelte';
	import SuspicionPanel from './suspicion-panel.svelte';
	import PhotoDialog from './photo-dialog.svelte';
	import { isMessageKey } from './format.js';
	let {
		ctx,
		basis,
		job
	}: {
		ctx: PageContext;
		basis: Row<'suspicion_reviews'>['basis'];
		job: Id<'job_assignments'>;
	} = $props();
	const t = ctx.t;
	const tk = (key: string) => (isMessageKey(key) ? ctx.t(key) : key);
	let opened = $state<{ name: string; url: string } | null>(null);
	const show = (photo: { name: string; url: string }) => (opened = photo);
	const matches = $derived(
		basis.candidates.map((candidate) => ({
			id: candidate.id,
			distance: candidate.distance.toFixed(3),
			flags: candidate.flags
				.map((flag) => enum_text(flag, { t: tk, model: 'photo_evidence', field: 'flags' }))
				.join(', '),
			matched: candidate.matched_photo_ids.length
		}))
	);
</script>

{#snippet fact(label: string, value: string | null | undefined, wide = false)}
	<div class={wide ? 'col-span-full' : undefined}>
		<dt class="text-xs text-muted-foreground">{label}</dt>
		<dd class="text-sm whitespace-pre-wrap">{value || t('component.not_recorded')}</dd>
	</div>
{/snippet}

<Stack gap="md">
	<Grid as="dl" minimum="compact" gap="md">
		{@render fact(t('component.job_title'), basis.job.title)}
		{@render fact(t('component.job_nature'), basis.job.nature)}
		<div>
			<dt class="text-xs text-muted-foreground">{t('component.scheduled_date')}</dt>
			<dd class="text-sm">
				<Show {ctx} kind={{ kind: 'date' }} value={basis.job.scheduled_for} />
			</dd>
		</div>
		{@render fact(t('component.site'), basis.site?.name)}
		{@render fact(
			t('models.sites.fields.house_type'),
			basis.site?.house_type
				? enum_text(basis.site.house_type, { t: tk, model: 'sites', field: 'house_type' })
				: null
		)}
		{@render fact(t('component.job_description_scope'), basis.job.description, true)}
		{#if basis.assignment.summary}{@render fact(
				t('component.completion_summary'),
				basis.assignment.summary,
				true
			)}{/if}
	</Grid>
	{#if matches.length > 0}<Table
			{ctx}
			of={matches}
			key="closest-matches"
			columns={[
				{ field: 'distance', label: t('component.match_distance'), align: 'end' },
				{ field: 'flags', label: t('component.match_flags') },
				{ field: 'matched', label: t('component.match_photos'), align: 'end' }
			]}
			toolbar={{ new: false, title: t('component.closest_matches') }}
		/>{/if}
	<SuspicionPanel {ctx} {job} on_open={show} findings={false} />
	<Section
		icon="lucide:messages-square"
		name="messages"
		title={t('models.communication_logs.label')}
		default_open={false}
		summary={t('component.recorded_count', { count: basis.communications.length })}
	>
		<Conversation {ctx} {job} on_open={show} />
	</Section>
</Stack>

<PhotoDialog bind:photo={opened} />
