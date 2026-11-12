<script lang="ts">
	/**
	 * A job: its scope and progress (the dispatch is the contractor's email or phone, linking that member), its
	 * conversation, and for a controller its review evidence and findings. Creating one can first add the site by its address.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordView, Button, Field, Form, RecordShell, Section } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import Conversation from '../../../../lib/conversation.svelte';
	import SuspicionPanel from '../../../../lib/suspicion-panel.svelte';
	import PhotoDialog from '../../../../lib/photo-dialog.svelte';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'job_assignments'>;
	} = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	/** Controllers read the review ledgers; the evidence tab and the finding banner are theirs. */
	const reviewer = $derived(ctx.catalog?.['suspicion_reviews'] !== undefined);
	const talker = $derived(ctx.catalog?.['communication_logs'] !== undefined);
	const open = $derived(
		id == null || !reviewer
			? null
			: ctx.query({
					suspicious_activity_logs: {
						where: { job_assignment_id: { eq: id }, resolved_at: { is_null: true } },
						fields: ['reason'],
						limit: 1
					}
				})
	);
	const finding = $derived(open?.current?.suspicious_activity_logs.rows[0]);
	let addingSite = $state(false);
	let opened = $state<{
		name: string;
		url: string;
	} | null>(null);
	const show = (photo: { name: string; url: string }) => (opened = photo);
</script>

{#snippet conversation()}{#if id}<Conversation {ctx} job={id} on_open={show} />{/if}{/snippet}
{#snippet evidence()}{#if id}<SuspicionPanel {ctx} job={id} on_open={show} />{/if}{/snippet}

{#if record == null}
	<Stack gap="md">
		<div>
			<Button
				variant="outline"
				aria-expanded={addingSite}
				onclick={() => (addingSite = !addingSite)}
			>
				<Icon icon="lucide:map-pin-plus" class="size-4" />{t('component.new_site_by_address')}
			</Button>
		</div>
		{#if addingSite}
			<Form
				{ctx}
				of="sites"
				mode="create"
				submit={t('component.add_site')}
				on_outcome={(o) => o.kind === 'committed' && (addingSite = false)}
			>
				{#snippet children()}
					<Grid minimum="card">
						<Field {ctx} name="location" address="address" />
						<Field {ctx} name="unit_number" />
					</Grid>
				{/snippet}
			</Form>
		{/if}
		<RecordShell
			{ctx}
			of="job_assignments"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
		>
			<Form
				{ctx}
				of="job_assignments"
				mode="create"
				values={view.mode === 'create' ? view.values : {}}
				submit={t('component.create_assignment')}
			>
				{#snippet children()}
					<Section icon="lucide:briefcase" first name="job" title={t('section.job')}>
						<Grid minimum="card">
							{#if view.mode !== 'create' || view.values.site_id == null}
								<Field {ctx} name="site_id" label={t('component.site')} />
							{/if}
							<Field {ctx} name="title" label={t('component.job_title')} />
							<Field {ctx} name="nature" label={t('component.job_nature')} />
							<Field {ctx} name="scheduled_for" label={t('component.scheduled_date')} />
							<Field {ctx} name="assignee_contact" label={t('component.contractor_contact')} />
							<Column span="all"
								><Field
									{ctx}
									name="description"
									label={t('component.job_description_scope')}
								/></Column
							>
						</Grid>
					</Section>
				{/snippet}
			</Form>
		</RecordShell>
	</Stack>
{:else}
	<RecordShell
		{ctx}
		of="job_assignments"
		id={record.id}
		subtitle={['status', 'dispatched_at']}
		{...finding
			? { icon: 'lucide:shield-alert', badge: t('component.suspicion_open'), hint: finding.reason }
			: {}}
		tabs={[
			...(talker
				? [{ name: 'conversation', title: t('component.conversation'), body: conversation }]
				: []),
			...(reviewer
				? [{ name: 'suspicions', title: t('component.suspicion_logs'), body: evidence }]
				: [])
		]}
	>
		<Form {ctx} of="job_assignments" mode="update" id={record.id} {record}>
			{#snippet children()}
				<Section icon="lucide:briefcase" first name="job" title={t('component.job_scope')}>
					<Grid minimum="card">
						<Field {ctx} name="site_id" label={t('component.site')} />
						<Field {ctx} name="title" label={t('component.job_title')} />
						<Field {ctx} name="nature" label={t('component.job_nature')} />
						<Field {ctx} name="scheduled_for" label={t('component.scheduled_date')} />
						<Column span="all"
							><Field
								{ctx}
								name="description"
								label={t('component.job_description_scope')}
							/></Column
						>
					</Grid>
				</Section>
				<Section icon="lucide:trending-up" name="progress" title={t('section.progress')}>
					<Grid minimum="card">
						<Field {ctx} name="status" />
						<Field {ctx} name="assignee_contact" label={t('component.contractor_contact')} />
						<Field {ctx} name="assignee_user_id" label={t('component.contractor')} />
						<Field {ctx} name="dispatched_at" label={t('component.dispatched_at')} readonly />
						<Field {ctx} name="completed_at" label={t('component.completed_at')} readonly />
					</Grid>
				</Section>
				<Section icon="lucide:circle-check" name="completion" title={t('section.completion')}>
					<Grid minimum="card">
						<Field {ctx} name="amount_charged" label={t('component.value_charged')} />
						<Column span="all"
							><Field {ctx} name="summary" label={t('component.completion_summary')} /></Column
						>
					</Grid>
				</Section>
				<Section
					icon="lucide:map-pin"
					name="reported_location"
					title={t('component.reported_location')}
					default_open={false}
					summary={record.location_address || t('component.not_recorded')}
				>
					<Field
						{ctx}
						name="location"
						address="location_address"
						label={t('component.reported_location')}
					/>
				</Section>
			{/snippet}
		</Form>
	</RecordShell>
{/if}

<PhotoDialog bind:photo={opened} />
