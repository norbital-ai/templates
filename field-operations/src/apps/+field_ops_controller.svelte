<script lang="ts">
	import { client } from '$bolt/client';
	import { getErrorMessage } from '@norbital-ai/std';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { Button } from '@norbital-ai/ui/button';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionKanban } from '@norbital-ai/ui/collection-kanban';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { DataRenderer } from '@norbital-ai/ui/data-renderer';
	import { Bound, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import { StaticMap, type StaticMapMarker } from '@norbital-ai/ui/static-map';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import Icon from '@iconify/svelte';
	import { Effect } from 'effect';
	import { importCollectionRecords } from '@norbital-ai/bolt/client';
	import { calendarDateInTimeZone, calendarDayOfInstant } from '../lib/calendar-date.js';
	import { csvRecords } from '../lib/csv.js';

	const today = calendarDateInTimeZone(new Date());

	const { t } = useI18n<TenantI18nKeys>();
	const collectionClient = getCollectionClientForSurface(client, 'field_ops_controller');

	let dispatchDay = $state(today);
	/**
	 * The stored form of the day, and the picker's value.
	 *
	 * A `precision: 'day'` field is one canonical UTC day — the date prefix every reader
	 * (`bolt_instant`, the list renderers) resolves — and the platform picker converts it to and
	 * from the viewer's zone itself. Handing it a viewer-local midnight instead applied that
	 * conversion twice, which showed the previous day to every viewer east of Greenwich.
	 */
	const dispatchQueryInstant = $derived(`${dispatchDay}T00:00:00.000Z`);
	/**
	 * The day's work, read once. The work order is the assignment row now — title, nature and site
	 * are its own columns — so a card needs no second query, and the map groups the same rows by
	 * site.
	 */
	const assignmentsQuery = $derived(
		client.db.job_assignments.findMany({
			where: { scheduled_for: { eq: dispatchQueryInstant } },
			columns: {
				id: true,
				site_id: true,
				title: true,
				nature: true,
				assignee_user_id: true,
				status: true,
				summary: true,
				// Live prefixes key by orderBy; omitting this is refused (learning 57).
				dispatched_at: true
			},
			orderBy: { dispatched_at: 'asc' },
			limit: 1000
		})
	);
	const assignments = $derived(assignmentsQuery.current ?? []);
	const visibleAssignmentIds = $derived(assignments.map((assignment) => assignment.id));
	const boardQuery = $derived({
		where: { scheduled_for: { eq: dispatchQueryInstant } },
		columns: {
			id: true,
			site_id: true,
			title: true,
			nature: true,
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
	function setDispatchDay(next: string): void {
		dispatchDay = next;
	}

	function updateDispatchDate(value: unknown): void {
		const selectedDay = calendarDayOfInstant(value);
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
	/** The review reads the whole board, so it asks for no selection; the toolbar reports a refusal. */
	const bulkPipelines = $derived([
		{
			id: 'suspicion-review',
			label: t('app.field_ops_controller.run_suspicion_review'),
			description: t('app.field_ops_controller.suspicion_review_description'),
			icon: 'lucide:shield-alert',
			getDisabledReason: () =>
				suspicionReviewRunning ? t('app.field_ops_controller.suspicion_review_running') : null,
			run: () =>
				Effect.tryPromise({
					try: () => suspicionReview.run({}),
					catch: (error) => new Error(getErrorMessage(error))
				})
		}
	]);

	/**
	 * A CSV of work orders — `site, scheduled_for, title`, optionally `nature, description,
	 * assignee_user_id, external_ref` — through the assignment import pipeline, which checks the whole
	 * sheet and files any site it does not know before it creates a row. A failure is the toolbar's
	 * to report; only the count is ours.
	 */
	let importMessage = $state<string | null>(null);
	function pickCsv(): Effect.Effect<File | null> {
		return Effect.callback((resume) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.csv,text/csv';
			let settled = false;
			const finish = (file: File | null): void => {
				if (settled) return;
				settled = true;
				resume(Effect.succeed(file));
			};
			input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
			// Dismissing the dialog fires `cancel`; without it the pipeline would spin forever.
			input.addEventListener('cancel', () => finish(null), { once: true });
			input.click();
		});
	}
	const importPipelines = $derived([
		{
			id: 'job-assignments-csv',
			label: t('app.field_ops_controller.import_assignments'),
			icon: 'lucide:upload',
			run: () =>
				Effect.gen(function* () {
					importMessage = null;
					const file = yield* pickCsv();
					if (file == null) return;
					const rows = csvRecords(yield* Effect.promise(() => file.text()));
					if (rows.length === 0) {
						return yield* Effect.fail(
							new Error(t('app.field_ops_controller.import_empty', { file: file.name }))
						);
					}
					const count = yield* Effect.tryPromise({
						try: () =>
							importCollectionRecords({
								records: [
									{ collection: 'job_assignments', id: crypto.randomUUID(), values: { rows } }
								]
							}),
						catch: (error) => new Error(getErrorMessage(error))
					});
					importMessage = t('app.field_ops_controller.import_done', { count, file: file.name });
				})
		}
	]);

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
			const siteAssignments = assignmentsBySite.get(assignment.site_id) ?? [];
			siteAssignments.push({
				id: assignment.id,
				job: assignment.title ?? t('component.job'),
				summary: assignment.summary?.trim() || null,
				status: assignment.status ?? 'assigned'
			});
			assignmentsBySite.set(assignment.site_id, siteAssignments);
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

	const banner =
		'/__bolt/request/api/template-seed-assets/field-operations/app-media/field_ops_controller-banner.webp';
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

{#snippet dispatchNavigation()}
	<Inline align="center" gap="sm" class="min-w-0">
		<div class="min-w-0">
			<DataRenderer
				field={{
					name: 'dispatch_date',
					kind: 'instant',
					nullable: false,
					precision: 'day'
				}}
				value={dispatchQueryInstant}
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
{/snippet}

{#snippet dispatchSchedule()}
	<Stack gap="sm" fill>
		{#if openSuspicionQuery?.error}
			<p class="px-1 text-sm text-destructive" role="alert">
				{t('app.field_ops_controller.review_status_failed')}
			</p>
		{/if}
		{#if suspicionReviewRunning && suspicionReviewPercent != null}
			<p role="status" class="px-1 text-sm tabular-nums text-muted-foreground">
				{t('app.field_ops_controller.suspicion_review_progress', {
					percent: suspicionReviewPercent,
					text: suspicionReviewSnapshot?.progress?.text ?? ''
				})}
			</p>
		{/if}
		{#if importMessage}
			<p role="status" class="px-1 whitespace-pre-line text-sm text-muted-foreground">
				{importMessage}
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
				<Bound
					size="full"
					pad="md"
					class="rounded-lg border bg-card [&_.kanban-lane]:gap-4 [&_.kanban-lane]:p-4"
				>
					<CollectionKanban
						client={collectionClient}
						collection="job_assignments"
						navigation={dispatchNavigation}
						{importPipelines}
						{bulkPipelines}
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
							<Field name="title" card="title" />
							<Field name="assignee_user_id" card="subtitle" />
						{/snippet}
						{#snippet Card(assignment)}
							<Stack gap="xs">
								<!--
										`nature`, not `title`. A title is composed as "<nature> — <site name>",
										so pairing it with the site underneath printed the same address twice
										and pushed the card past its own height. The nature is the half a
										dispatcher cannot infer from the address.
									-->
								<p class="line-clamp-2 text-sm leading-snug font-medium">
									{assignment.nature ?? '—'}
								</p>
								<p class="line-clamp-2 text-meta leading-snug">
									{siteNameById.get(String(assignment.site_id)) ?? '—'}
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

<AppShell
	icon="lucide:building-2"
	title="Field Operations Controller"
	description="Schedule site jobs and dispatch contractors"
	{banner}
	variant="full"
>
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
</AppShell>
