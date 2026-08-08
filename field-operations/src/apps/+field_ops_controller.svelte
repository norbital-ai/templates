<script lang="ts">
	import { client } from '$pod/client';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { CollectionKanban } from '@norbital-ai/ui/collection-kanban';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { DataRenderer } from '@norbital-ai/ui/data-renderer';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import { Bound, Cluster, Cover, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import { PageHeader } from '@norbital-ai/ui/page-header';
	import { StaticMap, type StaticMapMarker } from '@norbital-ai/ui/static-map';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { renderComponent } from '@norbital-ai/ui/utils';
	import Icon from '@iconify/svelte';
	import { calendarDateInTimeZone } from '../lib/calendar.js';
	import { downloadRosterTemplate, importWeeklyRoster } from '../lib/roster-import.js';

	const today = calendarDateInTimeZone(new Date());

	const { t } = useI18n<TenantI18nKeys>();

	let dispatchDay = $state(today);
	let rosterImporting = $state(false);
	let rosterFeedback = $state<{ kind: 'success' | 'error'; message: string } | null>(null);
	const dashboardQuery = $derived(
		client.invoke.field_ops_dashboard({ scheduled_for: dispatchDay })
	);
	const assignmentCardById = $derived(
		new Map((dashboardQuery.current?.assignment_cards ?? []).map((card) => [card.id, card]))
	);
	const monthSuspects = $derived(dashboardQuery.current?.month_suspects ?? []);
	// Reactive board query: when the dispatch day changes the dashboard refetches, the assignment
	// id list changes, and the kanban refetches automatically — no `{#key}` re-mount hack needed.
	const boardQuery = $derived({
		where: { norbital_id: { in: dashboardQuery.current?.assignment_ids ?? [] } },
		orderBy: { dispatched_at: 'asc' as const }
	});
	// View-level lane presentation: labels/colors live here, not on the model (pure data schema).
	const dispatchLanes = $derived([
		{ value: 'dispatched', label: t('component.status_dispatched'), color: 'blue' },
		{ value: 'in_progress', label: t('component.status_in_progress'), color: 'amber' },
		{ value: 'completed', label: t('component.status_completed'), color: 'green' },
		{ value: 'suspect', label: t('component.status_suspect'), color: 'red' }
	]);
	const sitesQuery = client.db.sites.findMany({
		orderBy: { name: 'asc' },
		limit: 250
	});
	const siteNameById = $derived(
		new Map((sitesQuery.current ?? []).map((site) => [site.norbital_id, site.name]))
	);

	function setDispatchDay(next: string): void {
		dispatchDay = next;
	}

	function updateDispatchDate(value: unknown): void {
		if (typeof value === 'string') setDispatchDay(value);
	}

	async function refreshDispatch(): Promise<void> {
		await dashboardQuery.refresh();
	}

	async function handleDownloadRosterTemplate(): Promise<void> {
		try {
			downloadRosterTemplate();
		} catch (reason) {
			rosterFeedback = {
				kind: 'error',
				message:
					reason instanceof Error
						? reason.message
						: t('app.field_ops_controller.roster_import_failed')
			};
		}
	}

	async function handleImportWeeklyRoster(): Promise<void> {
		if (rosterImporting) return;
		rosterImporting = true;
		rosterFeedback = null;
		try {
			const created = await importWeeklyRoster();
			if (created === 0) return;
			await refreshDispatch();
			rosterFeedback = {
				kind: 'success',
				message: t('app.field_ops_controller.roster_imported', { count: created })
			};
		} catch (reason) {
			rosterFeedback = {
				kind: 'error',
				message:
					reason instanceof Error
						? reason.message
						: t('app.field_ops_controller.roster_import_failed')
			};
		} finally {
			rosterImporting = false;
		}
	}

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
		<!-- stupidity:allow UI10 -- the map marker popover is width-constrained by the map overlay, not by a primitive -->
		<Stack gap="sm" class="w-64">
			<Stack gap="none">
				<h3 class="text-sm font-medium">{point.name}</h3>
				<p class="text-xs text-muted-foreground">{point.label}</p>
			</Stack>
			<Stack as="ul" gap="xs" class="border-t border-border pt-3">
				{#each point.assignments as assignment (assignment.id)}
					<li class="text-xs">
						<p class="font-medium">{assignment.job}</p>
						<p class="text-muted-foreground">
							{assignment.contractor} · {assignment.status.replaceAll('_', ' ')}
						</p>
					</li>
				{/each}
			</Stack>
		</Stack>
	{/if}
{/snippet}

<svelte:head>
	<title>Field Operations Controller</title>
	<meta name="description" content="Schedule site jobs and dispatch qualified contractors" />
	<meta name="pod:icon" content="lucide:building-2" />
	<meta
		name="pod:thumbnail"
		content="/api/template-seed-assets/field-operations/app-media/field_ops_controller-banner.svg"
	/>
	<meta
		name="pod:banner"
		content="/api/template-seed-assets/field-operations/app-media/field_ops_controller-banner.svg"
	/>
</svelte:head>

{#snippet dispatchSchedule()}
	<Stack gap="md">
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
					<Button variant="outline" onclick={() => void handleDownloadRosterTemplate()}>
						<Icon icon="lucide:download" class="mr-1.5 size-4 shrink-0" />
						{t('app.field_ops_controller.download_roster_template')}
					</Button>
					<Button
						variant="secondary"
						disabled={rosterImporting}
						onclick={() => void handleImportWeeklyRoster()}
					>
						<Icon icon="lucide:upload" class="mr-1.5 size-4 shrink-0" />
						{rosterImporting
							? t('app.field_ops_controller.importing_roster')
							: t('app.field_ops_controller.import_weekly_roster')}
					</Button>
				</Cluster>
			{/snippet}
		</Split>

		{#if rosterFeedback}
			<p
				class="rounded-md border px-3 py-2 text-sm whitespace-pre-line {rosterFeedback.kind ===
				'error'
					? 'border-destructive/40 bg-destructive/5 text-destructive'
					: 'border-border bg-muted/40 text-foreground'}"
				role={rosterFeedback.kind === 'error' ? 'alert' : 'status'}
			>
				{rosterFeedback.message}
			</p>
		{/if}

		{#if monthSuspects.length > 0}
			<Stack gap="xs" class="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
				<Inline gap="sm" align="center">
					<Icon icon="lucide:shield-alert" class="size-4 shrink-0 text-destructive" />
					<p class="text-sm font-medium text-destructive">
						{t('app.field_ops_controller.suspect_scrutiny_title', { count: monthSuspects.length })}
					</p>
				</Inline>
				<ul class="list-disc pl-5 text-sm text-destructive/90">
					{#each monthSuspects as suspect (suspect.id)}
						<li>{suspect.job}</li>
					{/each}
				</ul>
			</Stack>
		{:else if !dashboardQuery.loading}
			<p class="text-xs text-muted-foreground">
				{t('app.field_ops_controller.no_suspect_assignments')}
			</p>
		{/if}

		<Split
			ratio="wide"
			collapse="switch"
			switchLabels={[t('app.field_ops_controller.board'), t('app.field_ops_controller.map')]}
			gap="md"
		>
			{#snippet start()}
				<Bound size="tall" pad="sm" class="rounded-lg border bg-card">
					<CollectionKanban
						{client}
						collection="job_assignments"
						groupBy="status"
						lanes={dispatchLanes}
						rows={2}
						query={boardQuery}
					>
						{#snippet Card(assignment)}
							<Stack
								gap="xs"
								class={assignment.status === 'suspect'
									? 'rounded-md ring-2 ring-destructive/60'
									: undefined}
							>
								<Inline justify="between" gap="sm" align="start">
									<p class="text-sm font-medium">
										{assignmentCardById.get(assignment.norbital_id)?.job ??
											t('component.job_assignment')}
									</p>
									{#if assignment.status === 'suspect'}
										<Badge variant="destructive" class="shrink-0 text-[10px] uppercase">
											{t('component.status_suspect')}
										</Badge>
									{/if}
								</Inline>
								<p class="text-xs text-muted-foreground">
									{assignmentCardById.get(assignment.norbital_id)?.contractor ??
										t('component.contractor')}
								</p>
							</Stack>
						{/snippet}
					</CollectionKanban>
				</Bound>
			{/snippet}
			{#snippet end()}
				<Bound size="tall" clip class="rounded-lg">
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

		<CollectionTable
			{client}
			collection="jobs"
			title={t('app.field_ops_controller.jobs_scheduled_on', { date: dispatchDay })}
			description={t('app.field_ops_controller.jobs_scheduled_description')}
			query={{
				where: { scheduled_for: { eq: dispatchDay } },
				orderBy: { title: 'asc' }
			}}
			searchPlaceholder={t('app.field_ops_controller.search_jobs_on_date')}
		>
			{#snippet columns({ Column })}
				<Column name="title" minWidth={240} card="title" />
				<Column
					name="site_id"
					label={t('component.site')}
					minWidth={200}
					card="subtitle"
					render={({ row }) => siteNameById.get(row.site_id) ?? '—'}
				/>
				<Column name="status" card="badge" />
				<Column name="nature" label={t('component.job_nature')} minWidth={180} />
				<Column name="description" minWidth={240} />
			{/snippet}
		</CollectionTable>
	</Stack>
{/snippet}

{#snippet sites()}
	<CollectionTable
		{client}
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

{#snippet contractors()}
	<CollectionTable
		{client}
		collection="contractor_profiles"
		title={t('app.field_ops_controller.tab_contractors')}
		description={t('app.field_ops_controller.contractors_description')}
		query={{ orderBy: { company_name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="company_name" minWidth={240} card="title" />
			<Column
				name="user_id"
				label={t('component.portal_user')}
				minWidth={240}
				card="subtitle"
				render={({ value }) =>
					renderComponent(RelationshipRenderer, {
						target: 'user',
						value: typeof value === 'string' ? value : null,
						options: {
							label: (record) => {
								const v = record.name;
								return v != null && v !== '' ? String(v) : '—';
							},
							orderBy: { name: 'asc' },
							limit: 500
						},
						displayOnly: true
					})}
			/>
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet certifications()}
	<CollectionTable
		{client}
		collection="certification_types"
		title={t('app.field_ops_controller.certification_catalogue')}
		description={t('app.field_ops_controller.certifications_description')}
		query={{ orderBy: { name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="code" minWidth={140} card="badge" />
			<Column name="name" minWidth={240} card="title" />
			<Column name="category" minWidth={160} card="subtitle" />
			<Column name="issuing_body" label={t('component.issuing_body')} minWidth={200} />
			<Column name="active" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet pageHeading()}
	<PageHeader
		eyebrow={t('app.field_ops_controller.eyebrow')}
		title={t('app.field_ops_controller.header_title')}
		description={t('app.field_ops_controller.header_description')}
	/>
{/snippet}

<Cover as="main" top={pageHeading}>
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
			},
			{
				name: 'contractors',
				label: t('app.field_ops_controller.tab_contractors'),
				icon: 'lucide:hard-hat',
				content: contractors
			},
			{
				name: 'certifications',
				label: t('app.field_ops_controller.tab_certifications'),
				icon: 'lucide:badge-check',
				content: certifications
			}
		] satisfies TabConfig[]}
	/>
</Cover>
