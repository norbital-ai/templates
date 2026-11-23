<script lang="ts">
	/** A site: its details, the jobs still ahead of it (scheduled from today, or overdue and not done), and its history. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		Field,
		Form,
		RecordShell,
		Table,
		Timeline,
		enum_text,
		format,
		open_record,
		type RecordView,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Grid, Scroll } from '@norbital-ai/ui/layout';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'sites'>;
	} = $props();
	const t = ctx.t;
	const words: { t(key: string): string } = ctx;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Rolls over at midnight in the workspace zone, so "upcoming" follows the day. */
	const clock = ctx.clock('day');
	const historyQuery = $derived(
		record === null
			? null
			: ctx.query({
					job_assignments: {
						where: { site_id: { eq: record.id }, dispatched_at: { is_null: false } },
						fields: [
							'title',
							'dispatched_at',
							'status',
							'completed_at',
							'amount_charged',
							'location_address',
							'summary'
						],
						order_by: { dispatched_at: 'desc' }
					}
				})
	);
	const historyEntries = $derived<TimelineEntry[]>(
		(historyQuery?.current?.job_assignments.rows ?? []).map((row) => ({
			key: row.id,
			icon: row.status === 'completed' ? 'lucide:check-circle-2' : 'lucide:clock',
			tone: row.status === 'completed' ? 'success' : 'warning',
			title: row.title,
			line: [
				...(row.dispatched_at
					? [
							`${t('component.dispatched')} ${format({ kind: 'instant' }, row.dispatched_at, { locale: ctx.locale, ...(ctx.tz == null ? {} : { zone: ctx.tz }) })}`
						]
					: []),
				...(row.completed_at
					? [
							`${t('component.completed')} ${format({ kind: 'instant' }, row.completed_at, { locale: ctx.locale, ...(ctx.tz == null ? {} : { zone: ctx.tz }) })}`
						]
					: []),
				...(row.amount_charged != null
					? [format({ kind: 'money' }, row.amount_charged, { locale: ctx.locale })]
					: []),
				...(row.location_address ? [row.location_address] : [])
			],
			mark: {
				text: enum_text(row.status, {
					t: (k) => words.t(k),
					model: 'job_assignments',
					field: 'status'
				}),
				variant: row.status === 'completed' ? ('success' as const) : ('outline' as const)
			},
			...(row.summary ? { notes: [{ kind: 'summary', text: row.summary }] } : {}),
			onpick: () => open_record('job_assignments', row.id)
		}))
	);
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
	{#if record}
		<Scroll name={t('component.activity_history')} size="fill" inset>
			<Timeline entries={historyEntries} label={t('component.activity_history')}>
				{#snippet empty()}
					<EmptyState title={t('component.activity_history_empty')} />
				{/snippet}
			</Timeline>
		</Scroll>
	{/if}
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
