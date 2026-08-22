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
	import { calendarDateInTimeZone } from '../lib/calendar-date.js';

	const today = calendarDateInTimeZone(new Date());

	const { t } = useI18n<TenantI18nKeys>();

	let dispatchDay = $state(today);
	let assignContractorOpen = $state(false);
	const dashboardQuery = $derived(
		client.invoke.field_ops_dashboard({ scheduled_for: dispatchDay })
	);
	const assignmentCardById = $derived(
		new Map((dashboardQuery.current?.assignment_cards ?? []).map((card) => [card.id, card]))
	);
	// Reactive board query: when the dispatch day changes the dashboard refetches, the assignment
	// id list changes, and the kanban refetches automatically — no `{#key}` re-mount hack needed.
	const boardQuery = $derived({
		where: { id: { in: dashboardQuery.current?.assignment_ids ?? [] } },
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

	/**
	 * Which assignments have a suspicion nobody has answered.
	 *
	 * Read once for the board rather than per card: a query inside a card snippet runs per row and
	 * re-runs on every board update, which on a full dispatch day is hundreds of reads for one
	 * boolean each.
	 */
	const openSuspicionQuery = $derived(
		client.db.suspicious_activity_logs.findMany({
			where: { resolved_at: { isNull: true } },
			columns: { job_assignment_id: true },
			limit: 1000
		})
	);
	const suspiciousAssignmentIds = $derived(
		new Set((openSuspicionQuery.current ?? []).map((log) => log.job_assignment_id))
	);
	/**
	 * Asked of the record, not of its key.
	 *
	 * Reading `assignment.id` straight into a component prop trips `authored-system-columns`,
	 * and the rule is right: a surface threading the framework's own key back into a framework prop is
	 * telling it something it already knows. The question here is "is this one flagged", so that is
	 * what the surface asks.
	 */
	function assignmentRecordMetadata(assignment: { readonly id: string }) {
		if (!suspiciousAssignmentIds.has(assignment.id)) return [] as const;
		return [
			{
				kind: 'flag',
				tone: 'warning',
				icon: 'lucide:triangle-alert',
				label: t('component.review_suspicious_evidence'),
				description: t('component.suspicious_evidence_description')
			}
		] as const;
	}

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
		client.db.bolt_auth_user.findMany({
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
		if (typeof value === 'string') setDispatchDay(value);
	}

	const createAssignment = (): void => {
		if (assignment.jobId == null || assignment.assigneeUserId == null) return;
		void client.db.job_assignments.create({
			job_id: assignment.jobId,
			assignee_user_id: assignment.assigneeUserId,
			status: 'assigned',
			site_identity_unverified: true,
			site_identity_mismatch: false
		});
		assignment.jobId = null;
		assignment.assigneeUserId = null;
		assignContractorOpen = false;
	};

	const mapPoints = $derived(dashboardQuery.current?.map_points ?? []);
	const mapMarkers = $derived<StaticMapMarker[]>(
		mapPoints.map((point, index) => ({
			latitude: point.latitude,
			longitude: point.longitude,
			...(index < 26 ? { label: String.fromCharCode(65 + index) } : {}),
			ariaLabel: point.name,
			tone: point.assignments.some((assignment) => assignment.status === 'suspect')
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
						<p class="font-medium">{assignment.job}</p>
						<p class="text-muted-foreground">
							{assignment.assignee} · {assignment.status.replaceAll('_', ' ')}
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
						field={{ name: 'dispatch_date', kind: 'date', nullable: false }}
						value={dispatchDay}
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
						recordMetadata={assignmentRecordMetadata}
					>
						{#snippet Card(assignment)}
							<Stack gap="xs">
								<p class="text-sm font-medium">
									{assignmentCardById.get(assignment.id)?.job ?? t('component.job_assignment')}
								</p>
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

<Sheet.Root bind:open={assignContractorOpen}>
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
				void createAssignment();
			}}
		>
			<label class="grid gap-1.5 text-sm">
				<span class="font-medium">{t('app.field_ops_controller.job_and_site')}</span>
				<Combobox
					options={assignJobOptions}
					bind:value={assignment.jobId}
					emptyPlaceholder={t('app.field_ops_controller.select_unassigned_job')}
					searchPlaceholder={t('app.field_ops_controller.search_unassigned_jobs')}
					clientConfig={{
						isLoading: assignJobsQuery.loading,
						error: assignJobsQuery.error?.message ?? null
					}}
				/>
			</label>

			<label class="grid gap-1.5 text-sm">
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
					disabled={!assignSelectedJob}
				/>
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

			<Button
				type="submit"
				class="w-full"
				disabled={!assignment.jobId || !assignment.assigneeUserId}
			>
				{t('app.field_ops_controller.assign_contractor')}
			</Button>
		</Stack>
	</Sheet.Content>
</Sheet.Root>
