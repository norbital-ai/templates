<script lang="ts">
	/**
	 * A job: its scope, its progress (the dispatch is naming the contractor), its variations, its conversation, and for
	 * a controller its review evidence and findings. Creating one can first add the site by its address.
	 */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import {
		Button,
		Dialog,
		Field,
		Form,
		format,
		RecordShell,
		Show,
		useKinds
	} from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import Conversation from '../../../lib/conversation.svelte';
	import SuspicionPanel from '../../../lib/suspicion-panel.svelte';
	import { live } from '../../../lib/live.svelte.js';

	let { view }: { view: RecordView<'job_assignments'> } = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const id = $derived(record?.id);
	/** Controllers read the review ledgers; the evidence tab and the finding banner are theirs. */
	const reviewer = $derived(kinds.catalog?.['suspicion_reviews'] !== undefined);
	const talker = $derived(kinds.catalog?.['communication_logs'] !== undefined);
	const site = live(() =>
		record == null ? null : bolt.get('sites', record.site_id, { name: true })
	);
	const variations = live(() =>
		id == null
			? null
			: bolt.read('variation_requests', {
					where: { job_assignment_id: { eq: id } },
					orderBy: { requested_at: 'desc' },
					limit: 50
				})
	);
	const open = live(() =>
		id == null || !reviewer
			? null
			: bolt.read('suspicious_activity_logs', {
					where: { job_assignment_id: { eq: id }, resolved_at: { isNull: true } },
					select: { reason: true },
					limit: 1
				})
	);
	const finding = $derived(open.current?.rows[0]);
	let addingSite = $state(false);
	let opened = $state<{ name: string; url: string } | null>(null);
	const show = (photo: { name: string; url: string }) => (opened = photo);
</script>

{#snippet scope()}
	<Grid minimum="panel">
		<div>
			<p class="text-xs text-muted-foreground">{t('component.site')}</p>
			<p class="text-sm">{site.current?.name ?? t('component.not_recorded')}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">{t('component.job_title')}</p>
			<p class="text-sm">{record?.title ?? '—'}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">{t('component.job_nature')}</p>
			<p class="text-sm">{record?.nature ?? '—'}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">{t('component.scheduled_date')}</p>
			<p class="text-sm">{record?.scheduled_for ?? '—'}</p>
		</div>
		<Column span="all">
			<p class="text-xs text-muted-foreground">{t('component.job_description_scope')}</p>
			<p class="text-sm whitespace-pre-wrap">{record?.description ?? '—'}</p>
		</Column>
	</Grid>
{/snippet}

{#snippet variationList()}
	<Stack gap="sm">
		<p class="text-meta">
			{t('component.variations_description')} · {t('component.recorded_count', {
				count: variations.current?.rows.length ?? 0
			})}
		</p>
		{#each variations.current?.rows ?? [] as variation (variation.id)}
			<Stack gap="xs" class="rounded-md border p-3">
				<p class="text-sm font-medium">
					{variation.title}
					<span class="float-right"
						><Show kind={{ kind: 'money' }} value={variation.amount ?? null} /></span
					>
				</p>
				<p class="text-sm text-muted-foreground">{variation.description}</p>
				<p class="text-meta">
					{t('component.requested_at_instant', {
						instant: format({ kind: 'instant' }, variation.requested_at ?? null, {
							...kinds,
							locale: kinds.locale ?? bolt.locale
						})
					})}
				</p>
			</Stack>
		{:else}
			<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
				{t('component.no_variations')}
			</p>
		{/each}
	</Stack>
{/snippet}

{#snippet conversation()}<Conversation job={id!} onOpen={show} />{/snippet}
{#snippet evidence()}<SuspicionPanel job={id!} onOpen={show} />{/snippet}

{#if record == null}
	<Stack gap="md">
		<div>
			<Button
				variant="outline"
				size="sm"
				aria-expanded={addingSite}
				onclick={() => (addingSite = !addingSite)}
			>
				<Icon icon="lucide:map-pin-plus" class="size-4" />{t('component.new_site_by_address')}
			</Button>
		</div>
		{#if addingSite}
			<Form
				of="sites"
				mode="create"
				submit={t('component.add_site')}
				onOutcome={(o) => o.kind === 'committed' && (addingSite = false)}
			>
				{#snippet children()}
					<Grid minimum="panel">
						<Field name="name" label={t('component.site_address')} />
						<Field name="location" address="address" />
					</Grid>
				{/snippet}
			</Form>
		{/if}
		<RecordShell
			of="job_assignments"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
		>
			<Form
				of="job_assignments"
				mode="create"
				values={view.mode === 'create' ? view.values : {}}
				submit={t('component.create_assignment')}
			>
				{#snippet children()}
					<Grid minimum="panel">
						<Field name="site_id" label={t('component.site')} />
						<Field name="title" label={t('component.job_title')} />
						<Field name="nature" label={t('component.job_nature')} />
						<Field name="scheduled_for" label={t('component.scheduled_date')} />
						<Field name="assignee_user_id" label={t('component.contractor')} />
						<Column span="all"
							><Field name="description" label={t('component.job_description_scope')} /></Column
						>
					</Grid>
				{/snippet}
			</Form>
		</RecordShell>
	</Stack>
{:else}
	<RecordShell
		of="job_assignments"
		id={record.id}
		subtitle={['status', 'dispatched_at']}
		{...finding
			? { icon: 'lucide:shield-alert', badge: t('component.suspicion_open'), hint: finding.reason }
			: {}}
		tabs={[
			{ name: 'scope', title: t('component.job_scope'), body: scope },
			{ name: 'variations', title: t('component.variations'), body: variationList },
			...(talker
				? [{ name: 'conversation', title: t('component.conversation'), body: conversation }]
				: []),
			...(reviewer
				? [{ name: 'suspicions', title: t('component.suspicion_logs'), body: evidence }]
				: [])
		]}
	>
		<Form of="job_assignments" mode="update" id={record.id} {record}>
			{#snippet children()}
				<Grid minimum="panel">
					<Field name="status" />
					<Field name="assignee_user_id" label={t('component.contractor')} />
					<Field name="dispatched_at" label={t('component.dispatched_at')} />
					<Field name="completed_at" label={t('component.completed_at')} />
					<Field name="amount_charged" label={t('component.value_charged')} />
					<Column span="all"
						><Field name="summary" label={t('component.completion_summary')} /></Column
					>
					<Column span="all"
						><Field
							name="location"
							address="location_address"
							label={t('component.reported_location')}
						/></Column
					>
				</Grid>
			{/snippet}
		</Form>
	</RecordShell>
{/if}

<Dialog.Root open={opened !== null} onOpenChange={(next) => !next && (opened = null)}>
	<Dialog.Content class="max-w-5xl">
		{#if opened}
			<Dialog.Header><Dialog.Title>{opened.name}</Dialog.Title></Dialog.Header>
			<img
				src={opened.url}
				alt={opened.name}
				class="max-h-[75dvh] w-full rounded-md object-contain"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
