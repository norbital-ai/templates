<script lang="ts">
	import { client } from '../lib/workspace-client.js';
	import { Button } from '@norbital-ai/ui/button';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionKanban } from '@norbital-ai/ui/collection-kanban';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { CollectionForm, type CollectionFormSemantic } from '@norbital-ai/ui/collection-form';
	import { DataRenderer } from '@norbital-ai/ui/data-renderer';
	import { Bound, Cover, Inline, Split, Stack } from '@norbital-ai/ui/layout';
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
	const collectionClient = getCollectionClientForSurface(client, 'field_ops_controller');

	let dispatchDay = $state(today);
	/**
	 * The platform picker edits instants, while `jobs.scheduled_for` is deliberately a calendar-day
	 * key. Represent that day at the viewer's local midnight so the picker always shows the same day
	 * the query uses, including outside Singapore; converting a UTC midnight for display could move
	 * it into the previous day in western time zones.
	 */
	const dispatchPickerInstant = $derived(calendarDayAsPickerInstant(dispatchDay, pickerTimeZone));
	/** Day-precision instants are stored and compared at UTC midnight by the collection runtime. */
	const dispatchQueryInstant = $derived(`${dispatchDay}T00:00:00.000Z`);
	let assignContractorOpen = $state(false);
	const jobsQuery = $derived(
		client.db.jobs.findMany({
			where: { scheduled_for: { eq: dispatchQueryInstant } },
			columns: { id: true, site_id: true, title: true, nature: true },
			orderBy: { title: 'asc' },
			limit: 1000
		})
	);
	const jobs = $derived(jobsQuery.current ?? []);
	const jobById = $derived(new Map(jobs.map((job) => [job.id, job])));
	const assignmentsQuery = $derived(
		client.db.job_assignments.findMany({
			where: {
				job_assignment_job: { some: { scheduled_for: { eq: dispatchQueryInstant } } }
			},
			columns: {
				id: true,
				job_id: true,
				assignee_user_id: true,
				status: true,
				summary: true,
				search_text: true,
				// Live prefixes key by orderBy; omitting this is refused (learning 57).
				dispatched_at: true
			},
			orderBy: { dispatched_at: 'asc' },
			limit: 1000
		})
	);
	const assignments = $derived(assignmentsQuery.current ?? []);
	const visibleAssignmentIds = $derived(assignments.map((assignment) => assignment.id));
	/**
	 * Date changes start the assignment list and board together.
	 *
	 * This used to wait for jobs, then assignments, then feed those assignment ids into the board —
	 * three serial reactive reads before a card could appear. The relationship predicate is the same
	 * date fact expressed at the assignment boundary, so both live queries can start as soon as the
	 * picker changes while the jobs and sites needed by the map load alongside them.
	 */
	const boardQuery = $derived({
		where: {
			job_assignment_job: { some: { scheduled_for: { eq: dispatchQueryInstant } } }
		},
		columns: {
			id: true,
			job_id: true,
			assignee_user_id: true,
			status: true,
			dispatched_at: true
		},
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
		visibleAssignmentIds.length > 0
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
	const sitesQuery = $derived(
		client.db.sites.findMany({
			columns: { id: true, name: true, location: true },
			orderBy: { name: 'asc' },
			limit: 250
		})
	);
	const siteNameById = $derived(
		new Map((sitesQuery.current ?? []).map((site) => [site.id, site.name]))
	);
	/** Both picks required. The relation columns are non-nullable so the form already refuses an
	 * empty submit; this names the rule at the sheet so a cleared picker reads as one refusal. */
	const assignmentSemantic: CollectionFormSemantic = (values) =>
		Effect.succeed(
			typeof values.job_id === 'string' &&
				values.job_id !== '' &&
				typeof values.assignee_user_id === 'string' &&
				values.assignee_user_id !== ''
				? []
				: [{ message: t('component.assignment_picks_required'), path: [] }]
		);
	function setDispatchDay(next: string): void {
		dispatchDay = next;
	}

	function updateDispatchDate(value: unknown): void {
		const selectedDay = calendarDayFromPickerInstant(value, pickerTimeZone);
		if (selectedDay !== null) setDispatchDay(selectedDay);
	}

	const suspicionReview = $derived(client.automations.review_job_assignment_suspicion);
	const suspicionReviewPending = $derived(suspicionReview.pending);
	const suspicionReviewSnapshot = $derived(suspicionReview.latest?.current);
	const suspicionReviewActive = $derived(
		suspicionReviewSnapshot?.status === 'pending' || suspicionReviewSnapshot?.status === 'running'
	);
	const suspicionReviewRunning = $derived(
		suspicionReviewPending !== 0 ||
			(suspicionReviewActive &&
				suspicionReview.latest?.id != null &&
				suspicionReview.latest.id !== '')
	);
	const suspicionReviewPercent = $derived(
		suspicionReviewSnapshot?.progress == null
			? null
			: Math.round(suspicionReviewSnapshot.progress.progress * 100)
	);

	function assignmentStatusLabel(status: string): string {
		if (status !== 'unassigned' && status !== 'assigned' && status !== 'completed') {
			return status.replaceAll('_', ' ');
		}
		switch (status) {
			case 'unassigned':
				return t('component.status_unassigned');
			case 'assigned':
				return t('component.status_assigned');
			case 'completed':
				return t('component.status_completed');
			default: {
				const _exhaustive: never = status;
				return _exhaustive;
			}
		}
	}

	const mapPoints = $derived.by(() => {
		const assignmentsBySite = new Map<
			string,
			Array<{ id: string; job: string; summary: string | null; status: string }>
		>();
		for (const assignment of assignments) {
			const job = jobById.get(assignment.job_id);
			if (!job) continue;
			const siteAssignments = assignmentsBySite.get(job.site_id) ?? [];
			siteAssignments.push({
				id: assignment.id,
				job: job.title,
				summary: assignment.summary?.trim() || null,
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
							{assignment.summary
								? `${assignment.summary} · ${assignmentStatusLabel(assignment.status)}`
								: assignmentStatusLabel(assignment.status)}
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
	<!--
		One row, above the board it controls.

		This was a full-width `Split` stacking a label over the picker, and it spent a banded strip
		across the whole dashboard on one date and one button. Collapsed to a single line it sits
		inside the board column, which is what leaves the map a real column of its own rather than
		the leftover third of the page.
	-->
	<Inline justify="between" align="center" gap="sm" class="rounded-lg border bg-card px-3 py-2">
		<Inline align="center" gap="sm" class="min-w-0">
			<span class="shrink-0 text-xs font-medium text-muted-foreground">
				{t('app.field_ops_controller.dispatch_date')}
			</span>
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
			<Button
				variant="ghost"
				size="sm"
				class="h-6 shrink-0 px-2 text-xs"
				onclick={() => setDispatchDay(today)}
			>
				{t('app.field_ops_controller.today')}
			</Button>
		</Inline>
		<Inline align="center" gap="sm" class="shrink-0">
			{#if suspicionReviewRunning && suspicionReviewPercent != null}
				<span class="text-xs tabular-nums text-muted-foreground" role="status">
					{t('app.field_ops_controller.suspicion_review_progress', {
						percent: suspicionReviewPercent,
						text: suspicionReviewSnapshot?.progress?.text ?? ''
					})}
				</span>
			{/if}
			<Button
				variant="outline"
				size="sm"
				disabled={suspicionReviewRunning}
				onclick={() => {
					if (suspicionReviewRunning) return;
					void suspicionReview.run({});
				}}
			>
				<Icon icon="lucide:play" class="size-4 shrink-0" />
				{suspicionReviewRunning
					? t('app.field_ops_controller.suspicion_review_running')
					: t('app.field_ops_controller.run_suspicion_review')}
			</Button>
			<Button variant="secondary" size="sm" onclick={() => (assignContractorOpen = true)}>
				<Icon icon="lucide:user-round-check" class="size-4 shrink-0" />
				{t('app.field_ops_controller.assign_contractor')}
			</Button>
		</Inline>
	</Inline>
{/snippet}

{#snippet dispatchSchedule()}
	<Stack gap="sm" fill>
		{#if openSuspicionQuery?.error}
			<p class="px-1 text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>
		{/if}
		<Split
			ratio="wide"
			collapse="switch"
			switchLabels={[t('app.field_ops_controller.board'), t('app.field_ops_controller.map')]}
			gap="md"
			class="h-full"
		>
			{#snippet start()}
				<Cover gap="sm" top={dispatchControls}>
					<Bound size="full" pad="sm" class="rounded-lg border bg-card">
						<CollectionKanban
							client={collectionClient}
							collection="job_assignments"
							groupBy="status"
							lanes={dispatchLanes}
							rows={2}
							query={boardQuery}
							recordMetadata={(assignment) =>
								typeof assignment.id === 'string' && suspiciousAssignmentIds.has(assignment.id)
									? [
											{
												kind: 'flag',
												tone: 'warning',
												label: t('component.suspicion_open')
											}
										]
									: []}
						>
							{#snippet fields({ Field })}
								<Field name="job_id" card="title" />
								<Field name="assignee_user_id" card="subtitle" />
							{/snippet}
							<!--
								The two declared fields above are reference columns, and the board query does
								not expand either relation — so the automatic card had nothing to resolve them
								against and printed the target collection names, "Jobs" and "User", on every
								card. What a dispatcher needs to read is the job and where it is.

								Both are already in this component for the map: `jobById` from the same
								day-filtered jobs query the board is scoped to, and `siteNameById` from the
								sites query. Rendering from them costs no extra round trip, and keeps the
								visible words the related job's own title rather than the hidden search copy.
							-->
							{#snippet Card(assignment)}
								{@const job = jobById.get(String(assignment.job_id))}
								<Stack gap="xs">
									<!--
										`nature`, not `title`. A job's title is composed as
										"<nature> — <site name>", so pairing it with the site underneath printed
										the same address twice and pushed the card past its own height. The
										nature is the half a dispatcher cannot infer from the address.
									-->
									<p class="line-clamp-2 text-sm leading-snug font-medium">
										{job?.nature ?? '—'}
									</p>
									{#if job}
										<p class="line-clamp-2 text-meta leading-snug">
											{siteNameById.get(job.site_id) ?? '—'}
										</p>
									{/if}
								</Stack>
							{/snippet}
						</CollectionKanban>
					</Bound>
				</Cover>
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
		<div class="p-5">
			<CollectionForm
				client={collectionClient}
				collection="job_assignments"
				defaultValues={{ status: 'assigned' }}
				semantic={assignmentSemantic}
				success_message={t('component.assignment_created')}
				failure_message={t('component.assignment_create_failed')}
				submitLabel={t('app.field_ops_controller.assign_contractor')}
				onAfterSubmit={() => {
					assignContractorOpen = false;
				}}
			>
				{#snippet children({ Field })}
					<Field name="dispatched_at" hidden />
					<!-- Dispatched by this sheet; the create hook stamps the time. -->
					<Field name="status" hidden />
					<Field name="completed_at" hidden />
					<Field name="amount_charged" hidden />
					<Field name="location" hidden />
					<Field name="summary" hidden />
					<Field name="source_message_id" hidden />
					<Field name="suspicion_checked_at" hidden />
					<!-- Derived from the chosen job by `+hooks.ts` on create; never authored here. -->
					<Field name="search_text" hidden />
					<Stack gap="md">
						<Field
							name="job_id"
							label={t('app.field_ops_controller.job_and_site')}
							relationOptions={{
								label: (record) => {
									const v = record.title;
									return v != null && v !== '' ? String(v) : '—';
								},
								orderBy: { title: 'asc' },
								limit: 500
							}}
						/>
						<!--
							The assignee is a person, so the picker reads the identity directory directly.
							Authored workspace code declares which relation it is editing, but never
							receives a query handle for the platform-owned user table.
						-->
						<Field
							name="assignee_user_id"
							label={t('component.contractor')}
							relationOptions={{
								label: (record) => {
									const v = record.name;
									return v != null && v !== '' ? String(v) : '—';
								},
								orderBy: { name: 'asc' },
								limit: 500
							}}
						/>
					</Stack>
				{/snippet}
			</CollectionForm>
		</div>
	</Sheet.Content>
</Sheet.Root>
