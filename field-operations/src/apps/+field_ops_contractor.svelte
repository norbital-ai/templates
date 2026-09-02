<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../lib/workspace-client.js';
	import { collectionClient } from '../lib/collection-client.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Cover, Inline } from '@norbital-ai/ui/layout';

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

	const jobsQuery = $derived(
		client.db.jobs.findMany({
			orderBy: { scheduled_for: 'desc' },
			limit: 250
		})
	);
	const sitesQuery = $derived(
		client.db.sites.findMany({
			columns: { id: true, name: true },
			orderBy: { name: 'asc' },
			limit: 250
		})
	);
	const siteById = $derived(
		new Map((sitesQuery.current ?? []).map((site) => [site.id, site.name]))
	);
	const jobById = $derived(new Map((jobsQuery.current ?? []).map((job) => [job.id, job])));

	/**
	 * Status filter apply/clear, owned here rather than left to the nested field-picker popover.
	 * The last B3 probe opened that picker without publishing a clause, so Assigned rows stayed.
	 */
	let appliedStatusFilter = $state<'unassigned' | 'assigned' | 'completed' | null>(null);
	const statusFilterOptions = $derived([
		{ value: 'unassigned', label: t('component.status_unassigned') },
		{ value: 'assigned', label: t('component.status_assigned') },
		{ value: 'completed', label: t('component.status_completed') }
	]);
	const assignmentQuery = $derived({
		orderBy: { dispatched_at: 'desc' as const },
		...(appliedStatusFilter == null ? {} : { where: { status: { eq: appliedStatusFilter } } })
	});
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

{#snippet contractorFilters()}
	<Inline justify="between" align="center" gap="sm">
		{@render scopeNotice()}
		<Inline align="center" gap="sm" class="shrink-0">
			<div class="w-44">
				<Combobox
					options={statusFilterOptions}
					value={appliedStatusFilter}
					emptyPlaceholder={t('app.field_ops_contractor.filter_status_all')}
					searchPlaceholder={t('app.field_ops_contractor.filter_status')}
					ariaLabel={t('app.field_ops_contractor.filter_status')}
					onValueChange={(next) => {
						appliedStatusFilter =
							next === 'unassigned' || next === 'assigned' || next === 'completed' ? next : null;
					}}
				/>
			</div>
			{#if appliedStatusFilter != null}
				<Button variant="ghost" size="sm" onclick={() => (appliedStatusFilter = null)}>
					{t('app.field_ops_contractor.filter_clear')}
				</Button>
			{/if}
		</Inline>
	</Inline>
{/snippet}

<!-- App identity (title/description/icon) is rendered by the shell AppMediaHeader. -->
<Cover as="main" gap="md" top={contractorFilters}>
	<Bound size="full" inset>
		<CollectionTable
			client={collectionClient}
			collection="job_assignments"
			title={t('app.field_ops_contractor.dispatched_jobs')}
			description={t('app.field_ops_contractor.dispatched_jobs_description')}
			features={{ create: dispatchAuthority }}
			query={assignmentQuery}
		>
			{#snippet columns({ Column })}
				<Column
					name="job_id"
					label={t('component.job_site_date')}
					minWidth={360}
					card="title"
					renderer={FormattedValueRenderer}
					rendererProps={{
						format: ({ row }) => {
							const job = jobById.get(row.job_id);
							return job
								? `${job.title} · ${siteById.get(job.site_id) ?? '—'} · ${job.scheduled_for}`
								: t('component.job');
						}
					}}
				/>
				{#if dispatchAuthority}
					<!-- Whose assignment it is. Only meaningful to somebody looking at everybody's. -->
					<Column
						name="assignee_user_id"
						label={t('component.contractor')}
						minWidth={220}
						card="subtitle"
						relationOptions={{
							label: (record) => {
								const name = record.name;
								return name != null && name !== '' ? String(name) : '—';
							},
							orderBy: { name: 'asc' },
							limit: 500
						}}
					/>
				{/if}
				<Column name="dispatched_at" label={t('component.dispatched')} />
				<Column
					name="status"
					card="badge"
					renderer={FormattedValueRenderer}
					rendererProps={{
						format: ({ value }) => {
							switch (value) {
								case 'unassigned':
									return t('component.status_unassigned');
								case 'assigned':
									return t('component.status_assigned');
								case 'completed':
									return t('component.status_completed');
								default:
									return '—';
							}
						}
					}}
				/>
				<Column name="location" label={t('component.reported_location')} minWidth={220} />
				<Column name="summary" card="subtitle" minWidth={200} />
			{/snippet}
		</CollectionTable>
	</Bound>
</Cover>
