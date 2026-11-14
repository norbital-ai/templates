<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import { watch } from 'runed';
	import { input_schema, type ListRow } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Split, Stack } from '@norbital-ai/ui/layout';
	import { Board, Button, TimeInput, EmptyState, Form, Map, Sheet } from '@norbital-ai/ui';
	import Icon from '@iconify/svelte';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	/** Today in the workspace zone, rolling over at midnight. */
	const clock = ctx.clock('day');
	/** The day is in the URL, so opening a record (which re-renders the page) keeps it. */
	let day = $state<string>(new URL(location.href).searchParams.get('day') ?? clock.today);
	/** The day as a date; an unreadable one reads as today. */
	const date = $derived(Schema.is(input_schema({ kind: 'date' }))(day) ? day : clock.today);
	watch(
		() => day,
		() => {
			const url = new URL(location.href);
			if (url.searchParams.get('day') === day) return;
			url.searchParams.set('day', day);
			const state: unknown = history.state;
			history.replaceState(state, '', url);
		},
		{ lazy: false }
	);
	const jobs = $derived(
		ctx.query({
			job_assignments: {
				where: { scheduled_for: { eq: date } },
				fields: ['site_id'],
				limit: 1000
			}
		})
	);
	const dayJobs = $derived(jobs.current?.job_assignments.rows ?? []);
	const siteIds = $derived([...new Set(dayJobs.map((job) => job.site_id))]);
	const sites = $derived(
		siteIds.length === 0
			? null
			: ctx.query({
					sites: { where: { id: { in: siteIds } }, fields: ['name', 'location'], limit: 1000 }
				})
	);
	const siteName = $derived(
		new globalThis.Map((sites?.current?.sites.rows ?? []).map((site) => [site.id, site.name]))
	);
	const mappedSites = $derived(
		(sites?.current?.sites.rows ?? [])
			.filter((site) => site.location != null)
			.map((site) => site.id)
	);
	/** Read once for the board: which of the day's jobs carry a finding nobody has answered. */
	const open = $derived(
		dayJobs.length === 0
			? null
			: ctx.query({
					suspicious_activity_logs: {
						where: {
							resolved_at: { is_null: true },
							job_assignment_id: { in: dayJobs.map((job) => job.id) }
						},
						fields: ['job_assignment_id'],
						limit: 1000
					}
				})
	);
	const suspicious = $derived(
		new Set(
			(open?.current?.suspicious_activity_logs.rows ?? []).map((log) => log.job_assignment_id)
		)
	);
	let importing = $state(false);
</script>

{#snippet dayPicker()}
	<Cluster gap="xs" align="center">
		<label class="sr-only" for="dispatch-day"
			>{t('app.field_ops_controller.select_dispatch_date')}</label
		>
		<div class="w-40">
			<TimeInput
				id="dispatch-day"
				{ctx}
				value={day}
				on_change={(next: string | null) => (day = next ?? clock.today)}
			/>
		</div>
		<Button variant="ghost" onclick={() => (day = clock.today)}
			>{t('app.field_ops_controller.today')}</Button
		>
	</Cluster>
{/snippet}

{#snippet card({ row }: { row: ListRow<'job_assignments'> })}
	<Stack gap="xs">
		<p class="line-clamp-2 text-sm leading-snug font-medium">
			{#if suspicious.has(row.id)}
				<Icon
					icon="lucide:shield-alert"
					class="inline size-3.5 text-warning"
					aria-label={t('component.suspicion_open')}
				/>
			{/if}
			{row.nature ?? row.title}
		</p>
		<p class="line-clamp-2 text-meta leading-snug">{siteName.get(row.site_id) ?? '—'}</p>
		{#if row.assignee_user_id == null}
			<p class="text-meta leading-snug text-warning">
				<Icon icon="lucide:user-x" class="inline size-3.5" aria-hidden="true" />
				{t('component.no_contractor')}
			</p>
		{/if}
	</Stack>
{/snippet}

<AppShell
	icon="lucide:building-2"
	title={t('app.field_ops_controller.header_title')}
	description={t('app.field_ops_controller.header_description')}
>
	{#snippet actions()}{@render dayPicker()}{/snippet}
	<Stack gap="sm" size="fill">
		{#if open?.error}<p class="text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>{/if}
		<Split
			ratio="wide"
			collapse="switch"
			switch_labels={[t('app.field_ops_controller.tab_dispatch'), t('component.section_map')]}
			gap="md"
			size="fill"
		>
			{#snippet start()}
				<Board
					{ctx}
					of="job_assignments"
					by="status"
					key="dispatch"
					columns={2}
					where={{ scheduled_for: { eq: date } }}
					order_by={{ dispatched_at: 'asc' }}
					toolbar={{
						actions: [
							{
								icon: 'lucide:shield-alert',
								name: t('app.field_ops_controller.run_suspicion_review'),
								description: t('app.field_ops_controller.suspicion_review_description'),
								run: () => ctx.run('review_job_assignment_suspicion', {})
							},
							{
								icon: 'lucide:upload',
								name: t('app.field_ops_controller.import_assignments'),
								run: () => {
									importing = true;
								}
							}
						]
					}}
					lanes={['pending', 'completed']}
					{card}
				/>
			{/snippet}
			{#snippet end()}
				<Stack gap="sm" size="fill">
					{#if mappedSites.length > 0}
						<Map
							{ctx}
							of="sites"
							at="location"
							label="name"
							where={{ id: { in: mappedSites } }}
							toolbar={{ new: false }}
						/>
					{:else}
						<EmptyState variant="inset" title={t('app.field_ops_controller.map_empty', { date })} />
					{/if}
				</Stack>
			{/snippet}
		</Split>
	</Stack>
</AppShell>

<Sheet
	open={importing}
	on_open_change={(shown) => (importing = shown)}
	title={t('app.field_ops_controller.import_assignments')}
>
	{#if importing}
		<Form {ctx} of={{ automation: 'job_assignments_import_work_orders' }} fields={['file']} />
	{/if}
</Sheet>
