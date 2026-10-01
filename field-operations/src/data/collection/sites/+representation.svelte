<script lang="ts">
	/** A site: its details, the jobs still ahead of it (scheduled from today, or overdue and not done), and its history. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table, useKinds } from '@norbital-ai/ui';
	import { dayIn } from '../../../lib/format.js';

	let { view }: { view: RecordView<'sites'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
	const today = dayIn(useKinds().zone);
	// the site and whose it is stay open; the map pin and the geocoder's address fold away
	const sections: RecordSection[] = [
		{
			name: 'site',
			title: t('models.sites.singular'),
			fields: ['name', 'site_code', 'client_name', 'house_type', 'floor_area_sqm']
		},
		{
			name: 'map',
			title: t('component.section_map'),
			fields: ['location', 'address'],
			defaultOpen: false,
			summary: (r) =>
				String(r.address ?? '') ||
				(r.location == null ? t('component.summary_not_set') : t('component.summary_pinned'))
		}
	];
</script>

{#snippet upcoming()}
	{#if record}<Table
			of="job_assignments"
			key="site-upcoming"
			toolbar={{ title: t('component.upcoming_scheduled_jobs') }}
			where={{
				site_id: { eq: record.id },
				or: [{ scheduled_for: { gte: today } }, { status: { in: ['unassigned', 'assigned'] } }]
			}}
			orderBy={{ scheduled_for: 'asc' }}
			columns={[
				'title',
				{ field: 'scheduled_for', label: t('component.scheduled') },
				'status',
				{ field: 'nature', label: t('component.job_nature') },
				'description'
			]}
		/>{/if}
{/snippet}
{#snippet history()}
	{#if record}<Table
			of="job_assignments"
			key="site-history"
			toolbar={{ title: t('component.activity_history') }}
			where={{ site_id: { eq: record.id }, status: { in: ['assigned', 'completed'] } }}
			orderBy={{ dispatched_at: 'desc' }}
			columns={[
				'title',
				{ field: 'dispatched_at', label: t('component.dispatched') },
				'status',
				{ field: 'completed_at', label: t('component.completed') },
				{ field: 'amount_charged', label: t('component.value_charged') },
				{ field: 'location_address', label: t('component.reported_location') },
				'summary'
			]}
		/>{/if}
{/snippet}

{#if record == null}
	<RecordShell
		of="sites"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
		of="sites"
		id={record.id}
		subtitle={['client_name', 'house_type']}
		{sections}
		tabs={[
			{ name: 'upcoming', title: t('component.upcoming_jobs'), body: upcoming },
			{ name: 'activity', title: t('component.activity_history'), body: history }
		]}
	/>
{/if}
