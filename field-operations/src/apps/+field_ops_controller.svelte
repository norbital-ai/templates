<script lang="ts">
	import { client } from '../lib/workspace-client.js';
	import { collectionClient } from '../lib/collection-client.js';
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionKanban } from '@norbital-ai/ui/collection-kanban';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { DataRenderer } from '@norbital-ai/ui/data-renderer';
	import { Bound, Cluster, Cover, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import * as Sheet from '@norbital-ai/ui/sheet';
	import { StaticMap, type StaticMapMarker } from '@norbital-ai/ui/static-map';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import Icon from '@iconify/svelte';
	import { Effect } from 'effect';
	import {
		calendarDateInTimeZone,
		calendarDayAsPickerInstant,
		calendarDayFromPickerInstant
	} from '../lib/calendar-date.js';

	const today = calendarDateInTimeZone(new Date());
	const pickerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const { t } = useI18n<TenantI18nKeys>();

	let dispatchDay = $state(today);
	/**
	 * The platform picker edits instants, while `jobs.scheduled_for` is deliberately a calendar-day
	 * key. Represent that day at the viewer's local midnight so the picker always shows the same day
	 * the query uses, including outside Singapore; converting a UTC midnight for display could move
	 * it into the previous day in western time zones.
	 */
	const dispatchPickerInstant = $derived(calendarDayAsPickerInstant(dispatchDay, pickerTimeZone));
	let assignContractorOpen = $state(false);
	let assignmentSettling = $state(false);
	let assignmentSettlementError = $state<string | null>(null);
	const jobsQuery = $derived(
		client.db.jobs.findMany({
			where: { scheduled_for: { eq: dispatchDay } },
			columns: { id: true, site_id: true, title: true },
			orderBy: { title: 'asc' },
			limit: 1000
		})
	);
	const jobs = $derived(jobsQuery.current ?? []);
	const jobById = $derived(new Map(jobs.map((job) => [job.id, job])));
	const jobIds = $derived(jobs.map((job) => job.id));
	const assignmentsQuery = $derived(
		jobIds.length > 0
			? client.db.job_assignments.findMany({
					where: { job_id: { in: jobIds } },
					columns: {
						id: true,
						job_id: true,
						assignee_user_id: true,
						status: true
					},
					orderBy: { dispatched_at: 'asc' },
					limit: 1000
				})
			: undefined
	);
	const assignments = $derived(assignmentsQuery?.current ?? []);
	const visibleAssignmentIds = $derived(assignments.map((assignment) => assignment.id));
	// The board consumes the same sync-backed assignment ids as the cards and map.
	const boardQuery = $derived({
		where: { id: { in: visibleAssignmentIds } },
		orderBy: { dispatched_at: 'asc' as const }
	});
	// View-level lane presentation: labels/colors live here, not on the model (pure data schema).
	/**
	 * Three lanes, because an assignment has three states.
	 *
	 * `suspect` was a lane, which is what made suspicion mutually exclusive with progress: a job could
	 * be suspicious *or* completed and never both, and moving it on cleared the finding. Suspicion is
	 * a `suspicious_activity_logs` row now, drawn as an accent across whichever lane the work is
	 * actually in.
	 */
	const dispatchLanes = $derived([
		{ value: 'unassigned', label: t('component.status_unassigned'), color: 'slate' },
		{ value: 'assigned', label: t('component.status_assigned'), color: 'blue' },
		{ value: 'completed', label: t('component.status_completed'), color: 'green' }
	]);
	const suspicionReadAccessQuery = client.system.access.explain({
		action: 'read',
		resource: 'suspicious_activity_logs'
	});
	const mayReadSuspicion = $derived(suspicionReadAccessQuery.current?.allowed === true);

	/**
	 * Which assignments have a suspicion nobody has answered.
	 *
	 * Read once for the board rather than per card: a query inside a card snippet runs per row and
	 * re-runs on every board update, which on a full dispatch day is hundreds of reads for one
	 * boolean each.
	 */
	const openSuspicionQuery = $derived(
		mayReadSuspicion && visibleAssignmentIds.length > 0
			? client.db.suspicious_activity_logs.findMany({
					where: {
						resolved_at: { isNull: true },
						job_assignment_id: { in: visibleAssignmentIds }
					},
					columns: { job_assignment_id: true },
					orderBy: { created_at: 'asc' },
					limit: 1000
				})
			: undefined
	);
	const suspiciousAssignmentIds = $derived(
		new Set((openSuspicionQuery?.current ?? []).map((log) => log.job_assignment_id))
	);

	// Assign-contractor sheet — pairs an unassigned job for the day with the person who will do it.
	const assignJobsQuery = $derived(
		client.db.jobs.findMany({
			where: { scheduled_for: { eq: dispatchDay }, status: { eq: 'unassigned' } },
			orderBy: { title: 'asc' },
			limit: 250
		})
	);
	/**
	 * Who a job can be dispatched to: the workspace's people, read straight from the directory.
	 *
	 * One read, because there is one description of a person. The picker names the person directly
	 * rather than a company standing in front of them, so the same rows fill the picker and render
	 * whoever a job is dispatched to.
	 *
	 * The directory is every user, not only contractors: a person's team is not readable through the
	 * identity field mask (`id` and `name`, nothing else), so this list cannot be narrowed
	 * client-side to the `Contractor` team. Dispatching to somebody whose team confers no contractor
	 * policy produces a valid assignment they simply cannot open, which is a visible mistake rather
	 * than a silent one.
	 */
	const usersQuery = $derived(
		client.db.user.findMany({
			columns: { id: true, name: true },
			orderBy: { name: 'asc' },
			limit: 500
		})
	);
	const sitesQuery = $derived(
		client.db.sites.findMany({
			orderBy: { name: 'asc' },
			limit: 250
		})
	);
	const siteNameById = $derived(
		new Map((sitesQuery.current ?? []).map((site) => [site.id, site.name]))
	);
	const userNameById = $derived(
		new Map((usersQuery.current ?? []).map((user) => [user.id, user.name]))
	);
	const assignmentCardById = $derived(
		new Map(
			assignments.flatMap((assignment) => {
				const job = jobById.get(assignment.job_id);
				return job
					? [
							[
								assignment.id,
								{
									job: job.title,
									assignee: userNameById.get(assignment.assignee_user_id) ?? 'Unknown assignee'
								}
							] as const
						]
					: [];
			})
		)
	);
	/** What the assign-contractor sheet is about to submit; busy and failure states come from the mutation. */
	const assignment = $state<{ jobId: string | null; assigneeUserId: string | null }>({
		jobId: null,
		assigneeUserId: null
	});
	const assignSelectedJob = $derived(
		(assignJobsQuery.current ?? []).find((job) => job.id === assignment.jobId)
	);
	const assignJobOptions = $derived(
		(assignJobsQuery.current ?? []).map((job) => ({
			value: job.id,
			label: `${job.title} · ${siteNameById.get(job.site_id) ?? '—'}`
		}))
	);
	const assignContractorOptions = $derived(
		(usersQuery.current ?? []).map((user) => ({
			value: user.id,
			label: user.name
		}))
	);

	function setDispatchDay(next: string): void {
		dispatchDay = next;
	}

	function updateDispatchDate(value: unknown): void {
		const selectedDay = calendarDayFromPickerInstant(value, pickerTimeZone);
		if (selectedDay !== null) setDispatchDay(selectedDay);
	}

	function assignmentStatusLabel(status: string): string {
		switch (status) {
			case 'unassigned':
				return t('component.status_unassigned');
			case 'assigned':
				return t('component.status_assigned');
			case 'completed':
				return t('component.status_completed');
			default:
				return status.replaceAll('_', ' ');
		}
	}

	const createAssignment = (): void => {
		if (assignment.jobId == null || assignment.assigneeUserId == null) return;
		const jobId = assignment.jobId;
		const assigneeUserId = assignment.assigneeUserId;
		assignmentSettling = true;
		assignmentSettlementError = null;
		Effect.runFork(
			Effect.gen(function* () {
				const local = yield* Effect.tryPromise({
					try: () =>
						client.db.job_assignments.mutate({
							job_id: jobId,
							assignee_user_id: assigneeUserId,
							status: 'assigned'
						}),
					catch: (cause) => cause
				});
				// A dispatch is a scarce-resource allocation. Local durability is deliberately not enough to
				// dismiss its sheet: keep it visibly pending until policy and invariants settle on the server.
				const settlement = yield* Effect.tryPromise({
					try: () => local.settlement.wait(),
					catch: (cause) => cause
				});
				if (settlement.kind !== 'accepted' && settlement.kind !== 'rebased') {
					assignmentSettlementError =
						settlement.kind === 'rejected' ? settlement.message : settlement.quarantine.message;
					return;
				}
				assignment.jobId = null;
				assignment.assigneeUserId = null;
				assignContractorOpen = false;
			}).pipe(
				Effect.catch((cause) =>
					Effect.sync(() => {
						assignmentSettlementError =
							cause instanceof Error ? cause.message : t('component.assignment_create_failed');
					})
				),
				Effect.ensuring(Effect.sync(() => (assignmentSettling = false)))
			)
		);
	};

	const mapPoints = $derived.by(() => {
		const assignmentsBySite = new Map<
			string,
			Array<{ id: string; job: string; assignee: string; status: string }>
		>();
		for (const assignment of assignments) {
			const job = jobById.get(assignment.job_id);
			if (!job) continue;
			const siteAssignments = assignmentsBySite.get(job.site_id) ?? [];
			siteAssignments.push({
				id: assignment.id,
				job: job.title,
				assignee: userNameById.get(assignment.assignee_user_id) ?? 'Unknown assignee',
				status: assignment.status ?? 'assigned'
			});
			assignmentsBySite.set(job.site_id, siteAssignments);
		}

		return (sitesQuery.current ?? []).flatMap((site) => {
			const siteAssignments = assignmentsBySite.get(site.id) ?? [];
			const geometry = site.location?.geometry;
			if (!geometry || siteAssignments.length === 0) return [];
			return [
				{
					id: site.id,
					name: site.name,
					label: site.location?.formatted_address ?? site.name,
					latitude: geometry.lat,
					longitude: geometry.lon,
					assignments: siteAssignments
				}
			];
		});
	});
	const mapMarkers = $derived<StaticMapMarker[]>(
		mapPoints.map((point, index) => ({
			latitude: point.latitude,
			longitude: point.longitude,
			...(index < 26 ? { label: String.fromCharCode(65 + index) } : {}),
			ariaLabel: point.name,
			tone: point.assignments.some((assignment) => suspiciousAssignmentIds.has(assignment.id))
				? 'alert'
				: 'default'
		}))
	);
</script>

{#snippet mapMarkerContent(_marker: StaticMapMarker, index: number)}
	{@const point = mapPoints[index]}
	{#if point}
		<Stack gap="sm" class="w-64">
			<Stack gap="none">
				<h3 class="text-sm font-medium">{point.name}</h3>
				<p class="text-meta">{point.label}</p>
			</Stack>
			<Stack as="ul" gap="xs" class="border-t border-border pt-3">
				{#each point.assignments as assignment (assignment.id)}
					<li class="text-xs">
						<Inline align="start" gap="xs" class="min-w-0">
							{#if suspiciousAssignmentIds.has(assignment.id)}
								<Icon
									icon="lucide:shield-alert"
									class="mt-0.5 size-3.5 shrink-0 text-warning"
									aria-label={t('component.suspicion_open')}
								/>
							{/if}
							<p class="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
								{assignment.job}
							</p>
						</Inline>
						<p class="text-muted-foreground">
							{assignment.assignee} · {assignmentStatusLabel(assignment.status)}
						</p>
					</li>
				{/each}
			</Stack>
		</Stack>
	{/if}
{/snippet}

<svelte:head>
	<title>Field Operations Controller</title>
	<meta name="description" content="Schedule site jobs and dispatch contractors" />
	<meta name="bolt:icon" content="lucide:building-2" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/field-operations/app-media/field_ops_controller-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/field-operations/app-media/field_ops_controller-banner.webp"
	/>
</svelte:head>

{#snippet dispatchControls()}
	<Split ratio="wide" collapse="stack" gap="md" class="rounded-lg border bg-card p-3">
		{#snippet start()}
			<Stack gap="xs" class="max-w-md">
				<Inline justify="between" gap="sm">
					<span class="text-xs font-medium text-muted-foreground">
						{t('app.field_ops_controller.dispatch_date')}
					</span>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 px-2 text-xs"
						onclick={() => setDispatchDay(today)}
					>
						{t('app.field_ops_controller.today')}
					</Button>
				</Inline>
				<div class="min-w-0">
					<DataRenderer
						field={{
							name: 'dispatch_date',
							kind: 'instant',
							nullable: false,
							precision: 'day'
						}}
						value={dispatchPickerInstant}
						mode="edit"
						placeholder={t('app.field_ops_controller.select_dispatch_date')}
						onValueChange={updateDispatchDate}
					/>
				</div>
			</Stack>
		{/snippet}
		{#snippet end()}
			<Cluster gap="sm" justify="end">
				<Button variant="secondary" onclick={() => (assignContractorOpen = true)}>
					<Icon icon="lucide:user-round-check" class="size-4 shrink-0" />
					{t('app.field_ops_controller.assign_contractor')}
				</Button>
			</Cluster>
		{/snippet}
	</Split>
{/snippet}

{#snippet dispatchSchedule()}
	<Stack gap="sm" fill>
		{#if suspicionReadAccessQuery.error || openSuspicionQuery?.error}
			<p class="px-1 text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>
		{/if}
		<Cover gap="md" top={dispatchControls}>
			<Split
				ratio="wide"
				collapse="switch"
				switchLabels={[t('app.field_ops_controller.board'), t('app.field_ops_controller.map')]}
				gap="md"
				class="h-full"
			>
				{#snippet start()}
					<Bound size="full" pad="sm" class="rounded-lg border bg-card">
						<CollectionKanban
							client={collectionClient}
							collection="job_assignments"
							groupBy="status"
							lanes={dispatchLanes}
							rows={2}
							query={boardQuery}
						>
							{#snippet fields({ Field })}
								<Field name="job_id" card="title" />
								<Field name="assignee_user_id" card="subtitle" />
							{/snippet}
							{#snippet Card(assignment)}
								<Stack gap="xs">
									<Inline align="start" gap="xs" class="min-w-0">
										{#if suspiciousAssignmentIds.has(assignment.id)}
											<Icon
												icon="lucide:shield-alert"
												class="mt-0.5 size-4 shrink-0 text-warning"
												aria-label={t('component.suspicion_open')}
											/>
										{/if}
										<p class="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
											{assignmentCardById.get(assignment.id)?.job ?? t('component.job_assignment')}
										</p>
									</Inline>
									<p class="text-meta">
										{assignmentCardById.get(assignment.id)?.assignee ?? t('component.contractor')}
									</p>
								</Stack>
							{/snippet}
						</CollectionKanban>
					</Bound>
				{/snippet}
				{#snippet end()}
					<Bound size="full" clip class="rounded-lg">
						<StaticMap
							markers={mapMarkers}
							ariaLabel={t('app.field_ops_controller.dispatch_map_for', { date: dispatchDay })}
							emptyDescription={t('app.field_ops_controller.map_empty', { date: dispatchDay })}
							class="size-full"
							markerContent={mapMarkerContent}
						/>
					</Bound>
				{/snippet}
			</Split>
		</Cover>
	</Stack>
{/snippet}

{#snippet sites()}
	<CollectionTable
		client={collectionClient}
		collection="sites"
		title={t('app.field_ops_controller.tab_sites')}
		description={t('app.field_ops_controller.sites_description')}
		query={{ orderBy: { name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="name" minWidth={200} card="title" />
			<Column
				name="client_name"
				label={t('component.client_tenant')}
				minWidth={180}
				card="subtitle"
			/>
			<Column name="location" minWidth={260} />
			<Column name="house_type" label={t('component.site_type')} card="badge" />
			<Column name="floor_area_sqm" label={t('component.floor_area_sqm')} />
		{/snippet}
	</CollectionTable>
{/snippet}

<Cover as="main">
	<Tabs
		animate={false}
		config={[
			{
				name: 'dispatch',
				label: t('app.field_ops_controller.tab_dispatch'),
				icon: 'lucide:kanban',
				content: dispatchSchedule
			},
			{
				name: 'sites',
				label: t('app.field_ops_controller.tab_sites'),
				icon: 'lucide:map-pinned',
				content: sites
			}
		] satisfies TabConfig[]}
	/>
</Cover>

<Sheet.Root
	open={assignContractorOpen}
	onOpenChange={(open) => {
		if (!open && assignmentSettling) return;
		assignContractorOpen = open;
	}}
>
	<Sheet.Content flush class="sm:max-w-lg">
		<Sheet.Header class="border-b border-border px-5 py-4">
			<Sheet.Title>{t('app.field_ops_controller.sheet_title')}</Sheet.Title>
			<Sheet.Description>
				{t('app.field_ops_controller.sheet_description', { date: dispatchDay })}
			</Sheet.Description>
		</Sheet.Header>
		<Stack
			as="form"
			gap="md"
			class="p-5"
			onsubmit={(event) => {
				event.preventDefault();
				createAssignment();
			}}
		>
			<label class="block text-sm">
				<Stack gap="xs">
					<span class="font-medium">{t('app.field_ops_controller.job_and_site')}</span>
					<Combobox
						options={assignJobOptions}
						bind:value={assignment.jobId}
						disabled={assignmentSettling}
						emptyPlaceholder={t('app.field_ops_controller.select_unassigned_job')}
						searchPlaceholder={t('app.field_ops_controller.search_unassigned_jobs')}
						clientConfig={{
							isLoading: assignJobsQuery.loading,
							error: assignJobsQuery.error?.message ?? null
						}}
					/>
				</Stack>
			</label>

			<label class="block text-sm">
				<Stack gap="xs">
					<span class="font-medium">{t('component.contractor')}</span>
					<Combobox
						options={assignContractorOptions}
						bind:value={assignment.assigneeUserId}
						emptyPlaceholder={t('app.field_ops_controller.select_contractor')}
						searchPlaceholder={t('app.field_ops_controller.search_contractors')}
						clientConfig={{
							isLoading: usersQuery.loading,
							error: usersQuery.error?.message ?? null
						}}
						disabled={!assignSelectedJob || assignmentSettling}
					/>
				</Stack>
			</label>

			{#if assignSelectedJob && (usersQuery.current ?? []).length === 0}
				<p class="text-sm text-destructive" role="alert">
					{t('app.field_ops_controller.no_contractors')}
				</p>
			{/if}
			{#if (assignJobsQuery.current ?? []).length === 0 && !assignJobsQuery.loading}
				<p class="text-sm text-muted-foreground">
					{t('app.field_ops_controller.no_unassigned_jobs', { date: dispatchDay })}
				</p>
			{/if}
			{#if assignmentSettling}
				<p class="text-sm text-muted-foreground" role="status">
					{t('app.field_ops_controller.assigning')}
				</p>
			{:else if assignmentSettlementError}
				<p class="text-sm text-destructive" role="alert">{assignmentSettlementError}</p>
			{/if}

			<Button
				type="submit"
				class="w-full"
				disabled={!assignment.jobId ||
					!assignment.assigneeUserId ||
					client.db.job_assignments.pending > 0 ||
					assignmentSettling}
				aria-busy={client.db.job_assignments.pending > 0 || assignmentSettling}
			>
				{assignmentSettling
					? t('app.field_ops_controller.assigning')
					: t('app.field_ops_controller.assign_contractor')}
			</Button>
		</Stack>
	</Sheet.Content>
</Sheet.Root>
