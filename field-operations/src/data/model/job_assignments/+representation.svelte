<script lang="ts">
	/**
	 * A job: its scope and progress (the dispatch is naming the contractor), its variations, its conversation, and for
	 * a controller its review evidence and findings. Creating one can first add the site by its address.
	 */
	import { bolt } from '$bolt';
	import {
		type RecordView,
		Button,
		Dialog,
		Field,
		Form,
		RecordShell,
		Section,
		Table,
		useKinds
	} from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import Conversation from '../../../lib/conversation.svelte';
	import SuspicionPanel from '../../../lib/suspicion-panel.svelte';
	let {
		view
	}: {
		view: RecordView<'job_assignments'>;
	} = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	/** Controllers read the review ledgers; the evidence tab and the finding banner are theirs. */
	const reviewer = $derived(kinds.catalog?.['suspicion_reviews'] !== undefined);
	const talker = $derived(kinds.catalog?.['communication_logs'] !== undefined);
	const open = $derived(
		id == null || !reviewer
			? null
			: bolt.query('suspicious_activity_logs', {
					where: { job_assignment_id: { eq: id }, resolved_at: { isNull: true } },
					select: { reason: true },
					limit: 1
				})
	);
	const finding = $derived(open?.current?.rows[0]);
	let addingSite = $state(false);
	let opened = $state<{
		name: string;
		url: string;
	} | null>(null);
	const show = (photo: { name: string; url: string }) => (opened = photo);
</script>

{#snippet variationList()}
	{#if id}<Table
			of="variation_requests"
			key="job-variations"
			where={{ job_assignment_id: { eq: id } }}
			orderBy={{ requested_at: 'desc' }}
			columns={['title', 'description', 'amount', 'requested_at']}
			toolbar={{ new: false, description: t('component.variations_description') }}
		/>{/if}
{/snippet}

{#snippet conversation()}{#if id}<Conversation job={id} onOpen={show} />{/if}{/snippet}
{#snippet evidence()}{#if id}<SuspicionPanel job={id} onOpen={show} />{/if}{/snippet}

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
					<Grid minimum="card">
						<Field name="location" address="address" />
						<Field name="unit_number" />
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
					<Section first name="job" title={t('section.job')}>
						<Grid minimum="card">
							{#if view.mode !== 'create' || view.values.site_id == null}
								<Field name="site_id" label={t('component.site')} />
							{/if}
							<Field name="title" label={t('component.job_title')} />
							<Field name="nature" label={t('component.job_nature')} />
							<Field name="scheduled_for" label={t('component.scheduled_date')} />
							<Field name="assignee_user_id" label={t('component.contractor')} />
							<Column span="all"
								><Field name="description" label={t('component.job_description_scope')} /></Column
							>
						</Grid>
					</Section>
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
				<Section first name="job" title={t('component.job_scope')}>
					<Grid minimum="card">
						<Field name="site_id" label={t('component.site')} />
						<Field name="title" label={t('component.job_title')} />
						<Field name="nature" label={t('component.job_nature')} />
						<Field name="scheduled_for" label={t('component.scheduled_date')} />
						<Column span="all"
							><Field name="description" label={t('component.job_description_scope')} /></Column
						>
					</Grid>
				</Section>
				<Section name="progress" title={t('section.progress')}>
					<Grid minimum="card">
						<Field name="status" />
						<Field name="assignee_user_id" label={t('component.contractor')} />
						<Field name="dispatched_at" label={t('component.dispatched_at')} />
						<Field name="completed_at" label={t('component.completed_at')} />
					</Grid>
				</Section>
				<Section name="completion" title={t('section.completion')}>
					<Grid minimum="card">
						<Field name="amount_charged" label={t('component.value_charged')} />
						<Column span="all"
							><Field name="summary" label={t('component.completion_summary')} /></Column
						>
					</Grid>
				</Section>
				<Section
					name="reported_location"
					title={t('component.reported_location')}
					defaultOpen={false}
					summary={record.location_address || t('component.not_recorded')}
				>
					<Field
						name="location"
						address="location_address"
						label={t('component.reported_location')}
					/>
				</Section>
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
