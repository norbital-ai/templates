<script lang="ts">
	import { client } from '../lib/workspace-client.js';
	import { collectionClient } from '../lib/collection-client.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Cover } from '@norbital-ai/ui/layout';

	const { t } = useI18n<TenantI18nKeys>();

	const platform = getPlatformStateContext();

	/**
	 * Who is looking, answered by what the runtime says they may open — never by a client-side id.
	 *
	 * Never filter by `getPlatformStateContext()().user.id`. Despite its name that value is
	 * not an id at all: the shell
	 * builds it as `user.name`, which the workspace host builds as the local part of the signed-in
	 * address. So the filter sent `user_id = 'dion.neo'` to a `uuid()` column and every viewer got a
	 * failed query rendered as "Could not load your contractor profile."
	 *
	 * That collection is gone, and with it the lookup, the failure and the message. A contractor is a
	 * user; their assignments carry `assignee_user_id` and the contractor policy narrows this table to
	 * the requestor by column comparison on the server. There is nothing left for this app to resolve
	 * about the viewer beyond which framing to show, and `platform.apps` answers that without an id.
	 *
	 * It is `AccessControl.visibleApps`: the whole registry for anybody whose `user.status`
	 * is `admin`, and otherwise exactly the apps declared by the policies their one team holds.
	 * `+field_ops_controller.ts` declares `apps: ['field_ops_controller', 'field_ops_contractor']`
	 * and the contractor policy declares only its own, so the presence of the controller app in this
	 * list is precisely "administers or controls this workspace".
	 */
	const visibleApps = $derived(platform().apps);

	/**
	 * Whether that answer has arrived yet.
	 *
	 * The shell seeds its accessible-app list to `[]` and replaces it when the runtime answers, and an
	 * empty list is honoured as "may see nothing". Somebody is currently looking at this app, so a
	 * list that does not contain it is a list that has not landed — not a narrower viewer. Reading it
	 * as authority would flash the contractor framing at a controller on every load.
	 */
	const authoritySettled = $derived(visibleApps.includes('field_ops_contractor'));
	const dispatchAuthority = $derived(visibleApps.includes('field_ops_controller'));

	/**
	 * The people directory, for the assignee column a dispatcher needs and a contractor does not.
	 *
	 * Only fetched under dispatch authority: a scoped contractor sees only their own rows here, so the
	 * column would say the same thing on every line. `user` is granted to any authenticated
	 * subject masked to an id and a name, which is exactly what a name column needs.
	 */
	const usersQuery = $derived(
		dispatchAuthority
			? client.db.user.findMany({
					columns: { id: true, name: true },
					orderBy: { name: 'asc' },
					limit: 500
				})
			: undefined
	);
	const assigneeNameById = $derived(
		new Map((usersQuery?.current ?? []).map((user) => [user.id, user.name]))
	);

	const jobsQuery = $derived(
		client.db.jobs.findMany({
			orderBy: { scheduled_for: 'desc' },
			limit: 250
		})
	);
	const sitesQuery = $derived(client.db.sites.findMany({ orderBy: { name: 'asc' }, limit: 250 }));
	const siteById = $derived(
		new Map((sitesQuery.current ?? []).map((site) => [site.id, site.name]))
	);
	const jobById = $derived(new Map((jobsQuery.current ?? []).map((job) => [job.id, job])));
</script>

<svelte:head>
	<title>Contractor Workspace</title>
	<meta name="description" content="Update dispatched day jobs" />
	<meta name="bolt:icon" content="lucide:hard-hat" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/field-operations/app-media/field_ops_contractor-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/field-operations/app-media/field_ops_contractor-banner.webp"
	/>
</svelte:head>

{#snippet scopeNotice()}
	<!--
		One sentence about scope, and no failure mode.

		This used to be four branches — loading, error, dispatcher, contractor — because a contractor
		row had to be fetched before the app could say whose assignments these were, and a fetch has
		a loading state and a failure state. Nothing is fetched now: the viewer's scope is decided by
		the policy the server already applied to the table below, so the app states it and moves on.
	-->
	{#if !authoritySettled}
		<div
			class="h-5 w-72 max-w-full rounded bg-muted/50 motion-safe:animate-pulse"
			aria-label={t('component.loading')}
		></div>
	{:else if dispatchAuthority}
		<p class="text-sm text-muted-foreground">
			{t('app.field_ops_contractor.scope_workspace')}
		</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			{t('app.field_ops_contractor.scope_own')}
		</p>
	{/if}
{/snippet}

<!-- App identity (title/description/icon) is rendered by the shell AppMediaHeader. -->
<Cover as="main" gap="md" top={scopeNotice}>
	<Bound size="full" inset>
		<CollectionTable
			client={collectionClient}
			collection="job_assignments"
			title={t('app.field_ops_contractor.dispatched_jobs')}
			description={t('app.field_ops_contractor.dispatched_jobs_description')}
			query={{ orderBy: { dispatched_at: 'desc' } }}
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
							? `${job.title} · ${siteById.get(job.site_id) ?? '—'} · ${job.scheduled_for}`
							: t('component.job');
					}}
				/>
				{#if dispatchAuthority}
					<!-- Whose assignment it is. Only meaningful to somebody looking at everybody's. -->
					<Column
						name="assignee_user_id"
						label={t('component.contractor')}
						minWidth={220}
						card="subtitle"
						render={({ row }) => assigneeNameById.get(row.assignee_user_id) ?? '—'}
					/>
				{/if}
				<Column name="dispatched_at" label={t('component.dispatched')} />
				<Column
					name="status"
					card="badge"
					render={({ row, value }) => {
						// The contractor sees their assignment's progress, never the controller-only
						// integrity overlay: a `suspect` row reads as the linked job's own progression,
						// which the assignment hooks keep in lockstep for every non-flagged path.
						//
						// The overlay is withheld from the contractor, not from the surface. Somebody
						// holding dispatch is the audience it was written for, so on their view of this
						// same table `suspect` is reported as itself — hiding a flagged assignment from
						// the person who has to act on it was never the point of the mask.
						if (value === 'suspect' && dispatchAuthority) {
							return t('component.status_suspect');
						}
						if (value === 'suspect') {
							const job = jobById.get(row.job_id);
							switch (job?.status) {
								case 'assigned':
									return t('component.status_assigned');
								case 'in_progress':
									return t('component.status_in_progress');
								case 'completed':
									return t('component.status_completed');
								default:
									return '—';
							}
						}
						return typeof value === 'string' ? value : '—';
					}}
				/>
				<Column name="location" label={t('component.reported_location')} minWidth={220} />
				<Column name="summary" card="subtitle" minWidth={200} />
			{/snippet}
		</CollectionTable>
	</Bound>
</Cover>
