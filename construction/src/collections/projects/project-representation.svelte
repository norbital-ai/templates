<script lang="ts">
	import { mount, unmount, type Component } from 'svelte';
	import { collectionClient } from '../../collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { Row } from './$types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import {
		Bound,
		Cluster,
		Columns,
		Cover,
		Grid,
		Inline,
		Scroll,
		Split,
		Stack
	} from '@norbital-ai/ui/layout';
	import { formatDateRangeLocal } from '@norbital-ai/std/date';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import type { MoneyValue } from '../../datatypes/money/+definition.js';
	import type { IFCViewerProps } from './ifc-viewer/ifc_viewer.types.js';

	let { record }: { record: Row } = $props();

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * Calendar-day derivation for this workspace.
	 *
	 * `new Date().toISOString().slice(0, 10)` is the UTC day, not the site's day, so any site west of
	 * Greenwich prices and filters against yesterday for part of every day. `dates-and-time.md` names
	 * that expression as forbidden: derive the calendar day in a named timezone instead.
	 */

	/** The business timezone every calendar-day filter and "today" default resolves in. */
	const PROJECT_TIME_ZONE = 'Asia/Singapore';

	/** Calendar date for an instant in this workspace's business timezone, as `YYYY-MM-DD`. */
	function calendarDateInTimeZone(value: Date): string {
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: PROJECT_TIME_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(value);
		const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((part) => part.type === type)?.value ?? '';
		return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
	}

	/** Midnight of `calendarDate` in the business timezone, as the UTC instant that moment actually is. */
	function startOfDayInstant(calendarDate: string): string {
		const naive = Date.parse(`${calendarDate}T00:00:00Z`);
		if (Number.isNaN(naive)) throw new Error(`Not a calendar date: ${calendarDate}`);
		// Resolve twice: the offset at the guessed instant can differ from the offset at the real one
		// across a daylight-saving boundary.
		let instant = naive;
		for (let pass = 0; pass < 2; pass += 1) {
			const shown = Date.parse(`${calendarDateInTimeZone(new Date(instant))}T00:00:00Z`);
			instant += naive - shown;
		}
		return new Date(instant).toISOString();
	}

	/**
	 * "Now", as the instant a `contains_date` filter wants. A calendar day is not an instant, and the
	 * server refuses one rather than guessing which timezone turns it into a moment.
	 */
	function todayInstant(): string {
		return startOfDayInstant(calendarDateInTimeZone(new Date()));
	}

	/** The IFC viewer is a heavy esm.sh WebGL module graph; lazy-load it only when a model is linked. */
	const viewerModule = import('./ifc-viewer/ifc_viewer.svelte');

	function mountViewer(node: HTMLElement, mod: { default: Component<IFCViewerProps> }) {
		const instance = mount(mod.default, {
			target: node,
			props: {
				src: ifcDocument?.document_url ?? '',
				alt: ifcDocument?.title ?? t('component.current_ifc_model')
			}
		});
		return {
			destroy() {
				unmount(instance);
			}
		};
	}

	const projectId = $derived(record.id);

	const sitesQuery = $derived(
		collectionClient.db.site_locations.findMany({
			where: { project_id: { eq: projectId } },
			orderBy: { location_name: 'asc' },
			limit: 100
		})
	);

	const assignmentsQuery = $derived(
		collectionClient.db.job_assignments.findMany({
			where: { job_assignment_site_location: { project_id: { eq: projectId } } },
			orderBy: { updated_at: 'desc' },
			limit: 500
		})
	);

	const jobsQuery = $derived(
		collectionClient.db.jobs.findMany({
			where: { project_id: { eq: projectId } },
			columns: { id: true, job_title: true },
			orderBy: { job_title: 'asc' },
			limit: 500
		})
	);

	const workersQuery = $derived(
		collectionClient.db.workers.findMany({
			columns: { id: true, worker_name: true, trade: true },
			orderBy: { worker_name: 'asc' },
			limit: 500
		})
	);

	const claimsQuery = $derived(
		collectionClient.db.payment_claims.findMany({
			where: { project_id: { eq: projectId } },
			orderBy: { updated_at: 'desc' },
			limit: 100
		})
	);

	const documentsQuery = $derived(
		collectionClient.db.asset_documents.findMany({
			where: {
				project_id: { eq: projectId },
				status: { in: ['draft', 'in_review', 'issued'] }
			},
			orderBy: { updated_at: 'desc' },
			limit: 100
		})
	);

	const jobTitlesById = $derived(
		new Map((jobsQuery.current ?? []).map((job) => [String(job.id), job.job_title]))
	);
	const workersById = $derived(
		new Map((workersQuery.current ?? []).map((worker) => [String(worker.id), worker]))
	);
	const assignments = $derived(assignmentsQuery?.current ?? []);

	const claims = $derived(claimsQuery.current ?? []);
	const documents = $derived(documentsQuery.current ?? []);
	const ifcDocument = $derived(
		documents.find(
			(document) =>
				document.document_type === 'ifc_model' ||
				document.document_url?.toLowerCase().endsWith('.ifc')
		)
	);
	const loading = $derived(
		sitesQuery.loading ||
			Boolean(assignmentsQuery?.loading) ||
			claimsQuery.loading ||
			documentsQuery.loading
	);
	const loadError = $derived(
		sitesQuery.error ?? assignmentsQuery?.error ?? claimsQuery.error ?? documentsQuery.error
	);

	function formatDate(value: Date | string | null | undefined): string {
		if (!value) return t('component.not_set');
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
			new Date(value)
		);
	}

	function formatMoney(value: MoneyValue | null | undefined): string {
		if (!value) return t('component.not_set');
		return new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency: value.currency,
			maximumFractionDigits: 0
		}).format(value.value);
	}

	function sumMoney(values: readonly (MoneyValue | null | undefined)[]): string {
		const totals = new Map<string, number>();
		for (const value of values) {
			if (!value) continue;
			totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.value);
		}
		if (totals.size === 0) return t('component.no_value');
		return [...totals.entries()]
			.map(([currency, value]) => formatMoney({ currency, value }))
			.join(' · ');
	}
</script>

{#snippet projectSummary()}
	<Stack as="header" gap="md" class="border-b pb-5" aria-label={t('component.project_summary')}>
		<Cluster align="start" justify="between" gap="sm">
			<p class="min-w-0 text-sm text-muted-foreground">
				{record.project_number ?? t('component.no_project_number')} · {record.client ??
					t('component.no_client')}
			</p>
			<span class="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
				{record.status ?? t('component.status_not_set')}
			</span>
		</Cluster>
		<Grid minimum="compact" class="text-sm">
			<Stack gap="xs">
				<p class="text-meta">{t('component.programme')}</p>
				<p class="font-medium">
					{record.schedule_range
						? formatDateRangeLocal(record.schedule_range)
						: t('component.not_set')}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.contract_value')}</p>
				<p class="font-medium">{formatMoney(record.contract_value)}</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.main_contractor')}</p>
				<p class="font-medium">{record.main_contractor ?? t('component.not_set')}</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.project_manager')}</p>
				<p class="font-medium">{record.project_manager ?? t('component.not_set')}</p>
			</Stack>
		</Grid>
	</Stack>

	{#if loadError}
		<p
			class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
		>
			{loadError.message}
		</p>
	{/if}

	{#if loading}
		<p class="sr-only" aria-live="polite">{t('component.loading_operating_context')}</p>
	{/if}
{/snippet}

{#snippet coordinationModel()}
	<Stack gap="sm">
		<div>
			<h3 class="text-heading">{t('component.coordination_model')}</h3>
			<p class="max-w-[70ch] text-sm text-muted-foreground">
				{t('component.coordination_model_description')}
			</p>
		</div>
		{#if ifcDocument?.document_url}
			<Bound size="standard" clip class="rounded-md border bg-muted/30">
				<div class="relative h-full w-full">
					{#await viewerModule}
						<Inline
							align="center"
							justify="center"
							class="absolute inset-0 bg-background/80 text-sm text-muted-foreground"
						>
							{t('component.loading_viewer')}
						</Inline>
					{:then mod}
						<div class="h-full w-full" use:mountViewer={mod}></div>
					{:catch error}
						<Inline
							align="center"
							justify="center"
							class="absolute inset-0 bg-background/80 text-sm text-destructive"
						>
							{String(error)}
						</Inline>
					{/await}
				</div>
			</Bound>
		{:else if documentsQuery.loading}
			<div class="h-64 animate-pulse rounded-md bg-muted/60"></div>
		{:else}
			<Inline
				align="center"
				justify="center"
				class="h-64 rounded-md border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground"
			>
				{t('component.link_ifc_document')}
			</Inline>
		{/if}
	</Stack>
{/snippet}
{#snippet deliveryPulse()}
	<Stack as="aside" gap="md" class="border-t pt-4">
		<Stack gap="md">
			<p class="text-overline">
				{t('component.delivery_pulse')}
			</p>
			<dl class="divide-y text-sm">
				<Inline as="div" justify="between" class="py-2">
					<dt>{t('component.work_fronts')}</dt>
					<dd class="font-medium tabular-nums">{sitesQuery.current?.length ?? 0}</dd>
				</Inline>
				<Inline as="div" justify="between" class="py-2">
					<dt>{t('component.allocated_workers')}</dt>
					<dd class="font-medium tabular-nums">{assignments.length}</dd>
				</Inline>
				<Inline as="div" justify="between" class="py-2">
					<dt>{t('component.project_documents')}</dt>
					<dd class="font-medium tabular-nums">{documents.length}</dd>
				</Inline>
			</dl>
		</Stack>
		{#if record.description}
			<Stack gap="sm">
				<p class="text-overline">
					{t('component.scope')}
				</p>
				<p class="text-sm leading-normal">{record.description}</p>
			</Stack>
		{/if}
	</Stack>
{/snippet}

{#snippet coordination()}
	<Stack gap="lg">
		<Split ratio="wide" collapse="stack" start={coordinationModel} end={deliveryPulse} />

		<Grid minimum="panel">
			<CollectionTable
				client={collectionClient}
				collection="rfis"
				query={{ where: { project_id: { eq: projectId } }, limit: 25 }}
				title={t('component.rfis')}
				description={t('component.rfis_description')}
			>
				{#snippet columns({ Column })}
					<Column name="rfi_number" label={t('component.rfi')} />
					<Column name="title" minWidth={180} />
					<Column name="priority" />
					<Column name="status" />
					<Column name="due_date" label={t('component.due')} />
				{/snippet}
				{#snippet ListCard(rfi)}
					<Stack gap="xs">
						<Inline align="start" justify="between" gap="sm">
							<p class="truncate font-medium">{rfi.title}</p>
							<span class="shrink-0 text-meta">{rfi.status}</span>
						</Inline>
						<p class="truncate text-sm text-muted-foreground">
							{rfi.rfi_number} · {rfi.priority}
						</p>
					</Stack>
				{/snippet}
			</CollectionTable>
			<CollectionTable
				client={collectionClient}
				collection="defects"
				query={{ where: { project_id: { eq: projectId } }, limit: 25 }}
				title={t('component.defects')}
				description={t('component.defects_description')}
			>
				{#snippet columns({ Column })}
					<Column name="defect_number" label={t('component.defect')} />
					<Column name="title" minWidth={180} />
					<Column name="severity" />
					<Column name="status" />
					<Column name="due_date" label={t('component.due')} />
				{/snippet}
				{#snippet ListCard(defect)}
					<Stack gap="xs">
						<Inline align="start" justify="between" gap="sm">
							<p class="truncate font-medium">{defect.title}</p>
							<span class="shrink-0 text-meta">{defect.status}</span>
						</Inline>
						<p class="truncate text-sm text-muted-foreground">
							{defect.defect_number} · {defect.severity}
						</p>
					</Stack>
				{/snippet}
			</CollectionTable>
		</Grid>
	</Stack>
{/snippet}

{#snippet manpower()}
	<Stack gap="lg">
		<Stack gap="xs">
			<h3 class="text-heading">{t('component.manpower_allocation')}</h3>
			<p class="max-w-[70ch] text-sm text-muted-foreground">
				{t('component.manpower_allocation_description')}
			</p>
		</Stack>
		{#if sitesQuery.loading || Boolean(assignmentsQuery?.loading)}
			<Columns count={3}>
				{#each [1, 2, 3] as lane (lane)}
					<div class="h-64 animate-pulse rounded-md bg-muted/60"></div>
				{/each}
			</Columns>
		{:else if (sitesQuery.current?.length ?? 0) === 0}
			<div
				class="rounded-md border border-dashed px-6 py-12 text-center text-sm text-muted-foreground"
			>
				{t('component.add_site_location')}
			</div>
		{:else}
			<Bound size="standard" clip>
				<Scroll axis="x" name={t('component.manpower_allocation')} class="pb-2">
					<Inline align="start" gap="md">
						{#each sitesQuery.current ?? [] as site (site.id)}
							{@const siteAssignments = assignments.filter(
								(assignment) => assignment.site_location_id === site.id
							)}
							<Stack as="section" gap="md" class="w-72 rounded-md bg-muted/50 p-3">
								<Inline as="header" align="start" justify="between" gap="sm" class="border-b pb-3">
									<Stack gap="xs" class="min-w-0">
										<h4 class="truncate text-sm font-medium">{site.location_name}</h4>
										<p class="truncate text-meta">
											{site.location_code ?? site.location_type ?? t('component.work_front')}
										</p>
									</Stack>
									<span class="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums">
										{siteAssignments.length}
									</span>
								</Inline>
								<Stack gap="sm">
									{#each siteAssignments as assignment (assignment.id)}
										<Stack as="article" gap="md" class="rounded-md border bg-card p-3 shadow-xs">
											<Stack gap="xs">
												<p class="text-sm font-medium">
													{workersById.get(String(assignment.worker_id))?.worker_name ?? '—'}
												</p>
												<p class="text-meta">
													{jobTitlesById.get(String(assignment.job_id)) ?? '—'}
												</p>
											</Stack>
											<Inline justify="between" gap="sm" class="text-xs">
												<span
													>{assignment.role ??
														workersById.get(String(assignment.worker_id))?.trade ??
														t('component.site_role')}</span
												>
												<span class="text-muted-foreground tabular-nums"
													>{t('component.hours_per_day', {
														hours: assignment.hours_per_day ?? 0
													})}</span
												>
											</Inline>
										</Stack>
									{/each}
									{#if siteAssignments.length === 0}
										<p class="py-6 text-center text-meta">
											{t('component.no_allocations')}
										</p>
									{/if}
								</Stack>
							</Stack>
						{/each}
					</Inline>
				</Scroll>
			</Bound>
		{/if}
	</Stack>
{/snippet}

{#snippet controls()}
	<Stack gap="lg">
		<Grid minimum="compact">
			<Stack class="border-b pb-3" gap="xs">
				<p class="text-meta">{t('component.contract_value')}</p>
				<p class="text-heading">{formatMoney(record.contract_value)}</p>
			</Stack>
			<Stack class="border-b pb-3" gap="xs">
				<p class="text-meta">{t('component.claimed')}</p>
				<p class="text-heading">
					{sumMoney(claims.map((claim) => claim.claimed_amount))}
				</p>
			</Stack>
			<Stack class="border-b pb-3" gap="xs">
				<p class="text-meta">{t('component.certified')}</p>
				<p class="text-heading">
					{sumMoney(claims.map((claim) => claim.certified_amount))}
				</p>
			</Stack>
			<Stack class="border-b pb-3" gap="xs">
				<p class="text-meta">{t('component.documents')}</p>
				<p class="text-heading tabular-nums">{documents.length}</p>
			</Stack>
		</Grid>

		<Grid minimum="panel">
			<Stack as="section" gap="sm">
				<div class="border-b pb-2">
					<h3 class="text-sm font-semibold">{t('component.payment_claims')}</h3>
					<p class="text-meta">
						{t('component.payment_claims_description')}
					</p>
				</div>
				<div class="divide-y rounded-md border bg-card">
					{#each claims as claim (claim.id)}
						<Inline align="start" justify="between" gap="md" class="p-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{claim.claim_number}</p>
								<p class="text-meta capitalize">
									{claim.claim_type ?? t('component.progress_claim')} · {claim.status ??
										t('component.no_status')}
								</p>
							</div>
							<p class="text-sm font-medium tabular-nums">{formatMoney(claim.claimed_amount)}</p>
						</Inline>
					{:else}
						<p class="p-4 text-sm text-muted-foreground">{t('component.no_payment_claims')}</p>
					{/each}
				</div>
			</Stack>

			<Stack as="section" gap="sm">
				<div class="border-b pb-2">
					<h3 class="text-sm font-semibold">{t('component.project_documents')}</h3>
					<p class="text-meta">
						{t('component.project_documents_description')}
					</p>
				</div>
				<div class="divide-y rounded-md border bg-card">
					{#each documents as document (document.id)}
						<Inline align="start" justify="between" gap="md" class="p-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{document.title}</p>
								<p class="text-meta">
									{document.document_number ?? t('component.no_document_number')} ·
									{document.version ?? t('component.no_version')}
								</p>
							</div>
							{#if document.document_url}
								<a
									class="shrink-0 text-xs font-medium text-brand hover:underline"
									href={document.document_url}
									target="_blank"
									rel="noreferrer"
								>
									{t('component.open')}
								</a>
							{/if}
						</Inline>
					{:else}
						<p class="p-4 text-sm text-muted-foreground">{t('component.no_project_documents')}</p>
					{/each}
				</div>
			</Stack>
		</Grid>

		<CollectionTable
			client={collectionClient}
			collection="permits_to_work"
			query={{
				where: {
					project_id: { eq: projectId },
					validity_range: { contains_date: todayInstant() }
				},
				limit: 50
			}}
			title={t('component.permits_to_work')}
			description={t('component.permits_to_work_description')}
		>
			{#snippet columns({ Column })}
				<Column name="permit_number" label={t('component.permit')} />
				<Column name="permit_type" label={t('component.type')} />
				<Column name="status" />
				<Column name="validity_range" label={t('component.valid')} />
				<Column name="approved_by" label={t('component.approved_by')} />
			{/snippet}
			{#snippet ListCard(permit)}
				<Stack gap="xs">
					<Inline align="start" justify="between" gap="sm">
						<p class="truncate font-medium">{permit.permit_number}</p>
						<span class="shrink-0 text-meta">{permit.status}</span>
					</Inline>
					<p class="truncate text-sm text-muted-foreground">
						{permit.permit_type} · {t('component.expires', {
							date: formatDate(permit.validity_range?.end)
						})}
					</p>
				</Stack>
			{/snippet}
		</CollectionTable>
	</Stack>
{/snippet}

<Cover as="main" gap="md" top={projectSummary}>
	<Tabs
		animate={false}
		config={[
			{
				name: 'coordination',
				label: t('component.model_and_coordination'),
				icon: 'lucide:box',
				content: coordination
			},
			{
				name: 'manpower',
				label: t('component.manpower_allocation'),
				icon: 'lucide:users',
				content: manpower
			},
			{
				name: 'controls',
				label: t('component.commercial_and_controls'),
				icon: 'lucide:clipboard-check',
				content: controls
			}
		] satisfies TabConfig[]}
	/>
</Cover>
