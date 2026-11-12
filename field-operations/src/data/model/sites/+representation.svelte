<script lang="ts">
	/** A site: its details, the jobs still ahead of it (scheduled from today, or overdue and not done), and its history. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordView, Field, Form, RecordShell, Table } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'sites'>;
	} = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Rolls over at midnight in the workspace zone, so "upcoming" follows the day. */
	const clock = ctx.clock('day');
</script>

{#snippet upcoming()}
	{#if record}<Table
			{ctx}
			of="job_assignments"
			key="site-upcoming"
			toolbar={{ title: t('component.upcoming_scheduled_jobs') }}
			where={{
				site_id: { eq: record.id },
				or: [{ scheduled_for: { gte: clock.today } }, { status: { eq: 'pending' } }]
			}}
			order_by={{ scheduled_for: 'asc' }}
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
			{ctx}
			of="job_assignments"
			key="site-history"
			toolbar={{ title: t('component.activity_history') }}
			where={{ site_id: { eq: record.id }, dispatched_at: { is_null: false } }}
			order_by={{ dispatched_at: 'desc' }}
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
	<RecordShell {ctx} of="sites" mode="create" values={view.mode === 'create' ? view.values : {}}>
		<Form {ctx} of="sites" mode="create" values={view.mode === 'create' ? view.values : {}}>
			<Grid minimum="card">
				<Field {ctx} name="location" address="address" />
				<Field {ctx} name="unit_number" />
				<Field {ctx} name="site_code" />
				<Field {ctx} name="client_name" />
				<Field {ctx} name="house_type" />
				<Field {ctx} name="floor_area_sqm" />
			</Grid>
		</Form>
	</RecordShell>
{:else}
	<RecordShell
		{ctx}
		of="sites"
		id={record.id}
		subtitle={['client_name', 'house_type']}
		tabs={[
			{ name: 'upcoming', title: t('component.upcoming_jobs'), body: upcoming },
			{ name: 'activity', title: t('component.activity_history'), body: history }
		]}
	>
		<Form {ctx} of="sites" mode="update" id={record.id} {record}>
			<Grid minimum="card">
				<Field {ctx} name="location" address="address" />
				<Field {ctx} name="unit_number" />
				<Field {ctx} name="site_code" />
				<Field {ctx} name="client_name" />
				<Field {ctx} name="house_type" />
				<Field {ctx} name="floor_area_sqm" />
			</Grid>
		</Form>
	</RecordShell>
{/if}
