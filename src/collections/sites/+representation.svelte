<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';

	const FIELD_TIME_ZONE = 'Asia/Singapore';

	function calendarDateInTimeZone(value: Date): string {
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: FIELD_TIME_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(value);
		const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((part) => part.type === type)?.value ?? '';
		return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
	}

	let { record, close }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	// The site's key as a *query value* — what `jobs.site_id` points at. Framework surfaces are never
	// handed this: `CollectionForm` reads the record it is given, and `CollectionTable` scopes its
	// saved view to the open record on its own.
	const siteId = $derived(record?.norbital_id);
	const today = calendarDateInTimeZone(new Date());
	const siteJobsQuery = $derived(
		siteId
			? client.db.jobs.findMany({
					where: { site_id: { eq: siteId } },
					limit: 500
				})
			: null
	);
	const siteJobs = $derived(siteJobsQuery?.current ?? []);
	const upcomingJobIds = $derived(
		siteJobs
			.filter((job) => {
				const jobDate = calendarDateInTimeZone(new Date(job.scheduled_for));
				return (
					jobDate >= today ||
					(jobDate < today && (job.status === 'unassigned' || job.status === 'assigned'))
				);
			})
			.map((job) => job.norbital_id)
	);
	const jobById = $derived(new Map(siteJobs.map((job) => [job.norbital_id, job] as const)));
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/field-operations/record-media/sites-banner.svg"
	/>
</svelte:head>

{#if record}
	{#snippet generalInformation()}
		<CollectionForm {client} collection="sites" defaultValues={record}>
			{#snippet children({ Field })}
				<Stack gap="md">
					<div>
						<h3 id="site-general-heading" class="text-sm font-semibold">
							{t('component.general_information')}
						</h3>
						<p class="text-sm text-muted-foreground">
							{t('component.general_information_description')}
						</p>
					</div>
					<Grid minimum="panel">
						<Field name="name" />
						<Field name="client_name" label={t('component.client_tenant')} />
						<Field name="house_type" label={t('component.site_type')} />
						<Field name="floor_area_sqm" label={t('component.floor_area_sqm')} />
						<Column span="all"><Field name="location" /></Column>
					</Grid>
				</Stack>
			{/snippet}
		</CollectionForm>
	{/snippet}

	{#snippet upcomingJobs()}
		<CollectionTable
			{client}
			collection="jobs"
			view="field_ops_site:upcoming"
			title={t('component.upcoming_scheduled_jobs')}
			description={t('component.upcoming_scheduled_jobs_description')}
			query={{
				where: { norbital_id: { in: upcomingJobIds } },
				orderBy: { scheduled_for: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="title" minWidth={240} card="title" />
				<Column name="scheduled_for" label={t('component.scheduled')} card="badge" />
				<Column name="status" />
				<Column name="nature" label={t('component.job_nature')} minWidth={180} />
				<Column name="description" card="subtitle" minWidth={200} />
			{/snippet}
		</CollectionTable>
	{/snippet}

	{#snippet activityHistory()}
		<CollectionTable
			{client}
			collection="job_assignments"
			view="field_ops_site:history"
			title={t('component.activity_history')}
			description={t('component.activity_history_description')}
			query={{
				where: {
					job_assignment_job: {
						site_id: { eq: siteId },
						status: { in: ['assigned', 'completed'] }
					}
				},
				orderBy: { dispatched_at: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column
					name="job_id"
					label={t('component.job_site_date')}
					minWidth={360}
					card="title"
					render={({ row }) => {
						const job = jobById.get(row.job_id);
						return job
							? `${job.title} · ${record.name} · ${job.scheduled_for}`
							: t('component.job');
					}}
				/>
				<Column name="dispatched_at" label={t('component.dispatched')} />
				<Column name="status" card="badge" />
				<Column name="completed_at" label={t('component.completed')} />
				<Column name="amount_charged" label={t('component.value_charged')} />
				<Column name="location" label={t('component.reported_location')} minWidth={220} />
				<Column name="summary" card="subtitle" minWidth={200} />
			{/snippet}
		</CollectionTable>
	{/snippet}

	<Tabs
		animate={false}
		contentPadding={false}
		listClass="mx-0 w-full"
		config={[
			{
				name: 'general',
				label: t('component.general_information'),
				icon: 'lucide:building',
				content: generalInformation
			},
			{
				name: 'upcoming',
				label: t('component.upcoming_jobs'),
				icon: 'lucide:calendar-clock',
				content: upcomingJobs
			},
			{
				name: 'history',
				label: t('component.activity_history'),
				icon: 'lucide:history',
				content: activityHistory
			}
		] satisfies TabConfig[]}
	/>
{:else}
	<CollectionForm
		{client}
		collection="sites"
		submitLabel={t('component.add_site')}
		onAfterSubmit={close}
	>
		{#snippet children({ Field })}
			<Grid minimum="panel">
				<Field name="name" />
				<Field name="client_name" label={t('component.client_tenant')} />
				<Field name="house_type" label={t('component.site_type')} />
				<Field name="floor_area_sqm" label={t('component.floor_area_sqm')} />
				<Column span="all"><Field name="location" /></Column>
			</Grid>
		{/snippet}
	</CollectionForm>
{/if}
