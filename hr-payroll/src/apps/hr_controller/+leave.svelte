<script lang="ts">
	import { client } from '$pod/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/pod/client/app-header-actions';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import {
		formatCalendarDate,
		formatLeaveAccrual,
		formatLeavePayrollEffect,
		formatNumeric
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';

	const { t } = useI18n<TenantI18nKeys>();

	let selectedCompanyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The leave-type catalogue opens on the entitlements in force today, as a filter chip the
	 * operator can drop to reach superseded versions. The legal-entity selector keeps `activeRange`
	 * in its own query: it is the page's scope picker, not a listing, and it has to default to an
	 * entity that still exists.
	 */
	const companiesQuery = client.db.companies.findMany({
		where: { norbital_approval_id: { isNull: true }, ...activeRange },
		orderBy: { name: 'asc' },
		limit: 500
	});
	const companies = $derived(companiesQuery.current ?? []);
	const companiesUnknown = $derived(companiesQuery.current === undefined || companiesQuery.loading);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.norbital_id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	$effect(() => {
		if (
			companies.length > 0 &&
			(selectedCompanyId == null ||
				!companies.some((company) => company.norbital_id === selectedCompanyId))
		) {
			selectedCompanyId = companies[0]!.norbital_id;
		}
	});

	const analyticsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.invoke.approval_analytics({ subject: 'LEAVE', company_id: selectedCompanyId })
	);
	const analytics = $derived(
		analyticsQuery?.current ?? {
			total: 0,
			seasonal_heatmap: []
		}
	);
	const heatmapMaximum = $derived(
		Math.max(0, ...analytics.seasonal_heatmap.flatMap((row) => row.months))
	);

	function heatmapClass(count: number): string {
		if (count === 0 || heatmapMaximum === 0) return 'bg-muted/35 text-muted-foreground';
		const level = Math.ceil((count / heatmapMaximum) * 5);
		switch (level) {
			case 1:
				return 'bg-primary/10 text-foreground';
			case 2:
				return 'bg-primary/25 text-foreground';
			case 3:
				return 'bg-primary/45 text-primary-foreground';
			case 4:
				return 'bg-primary/70 text-primary-foreground';
			default:
				return 'bg-primary text-primary-foreground';
		}
	}

	type NestedLeaveRequest = {
		readonly leave_request_type?: {
			readonly code?: string | null;
			readonly name?: string | null;
		} | null;
		readonly leave_request_employment?: { readonly employee_number?: string | null } | null;
	};

	function nestedLeaveRequest(row: unknown): NestedLeaveRequest {
		return row as NestedLeaveRequest;
	}

	function leaveTypeLabel(row: unknown): string {
		const leaveType = nestedLeaveRequest(row).leave_request_type;
		if (leaveType?.code && leaveType.name) return `${leaveType.code} · ${leaveType.name}`;
		if (leaveType?.code) return leaveType.code;
		return '—';
	}

	function employmentLabel(row: unknown): string {
		return nestedLeaveRequest(row).leave_request_employment?.employee_number ?? '—';
	}

	function leaveRangeLabel(row: unknown): string {
		const event = (row as { readonly event?: unknown }).event;
		if (event == null || typeof event !== 'object' || !('kind' in event)) return '—';
		if (event.kind !== 'TIME_OFF' || !('range' in event)) return '—';
		const range = event.range as {
			readonly start?: { readonly date?: string; readonly half?: string };
			readonly end?: { readonly date?: string; readonly half?: string };
		};
		if (range.start?.date == null || range.end?.date == null) return '—';
		const half = (value: string | undefined) =>
			value === 'FIRST' ? t('component.first_half') : t('component.second_half');
		return `${formatCalendarDate(range.start.date)}, ${half(range.start.half)} → ${formatCalendarDate(range.end.date)}, ${half(range.end.half)}`;
	}
</script>

<svelte:head>
	<title>Leave</title>
	<meta name="description" content="Review leave events and the leave types that entitle them" />
	<meta name="pod:icon" content="lucide:calendar-check-2" />
	<meta
		name="pod:thumbnail"
		content="/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
	/>
	<meta
		name="pod:banner"
		content="/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<Combobox
		ariaLabel={t('component.legal_entity')}
		options={companyOptions}
		value={selectedCompanyId}
		onValueChange={(value) => {
			if (typeof value === 'string') {
				selectedCompanyId = value;
				return;
			}
			selectedCompanyId = companies[0]?.norbital_id ?? null;
		}}
		emptyPlaceholder={t('component.select_legal_entity')}
		searchPlaceholder={t('component.search_companies')}
		clientConfig={{
			isLoading: companiesQuery.loading,
			error: companiesQuery.error?.message ?? null
		}}
		class="min-w-[16rem]"
	/>
{/snippet}

{#snippet overview()}
	{#if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.leave.loading_company_scope')}</span>
		</Inline>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.leave.empty_overview')}</p>
	{:else}
		<Stack as="section" gap="md" aria-labelledby="leave-seasonality-heading">
			<div>
				<h2 class="text-lg font-semibold">{t('app.leave.leave_activity')}</h2>
				<p class="text-sm text-muted-foreground">
					{t('app.leave.leave_activity_description', { count: analytics.total.toLocaleString() })}
				</p>
			</div>
			<div class="rounded-lg border bg-card p-4 shadow-card">
				<Stack gap="md">
					<div>
						<h3 id="leave-seasonality-heading" class="font-semibold">
							{t('app.leave.chart_title')}
						</h3>
						<p class="text-sm text-muted-foreground">{t('app.leave.chart_description')}</p>
					</div>
					{#if analyticsQuery?.loading}
						<p class="py-8 text-center text-sm text-muted-foreground">
							{t('app.leave.loading_seasonality')}
						</p>
					{:else if analyticsQuery?.error}
						<p class="py-8 text-center text-sm text-destructive">
							{t('app.leave.seasonality_error')}
						</p>
					{:else}
						<!-- stupidity:allow UI3 -- this is a derived reporting matrix, not a collection. -->
						<table class="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
							<caption class="sr-only">{t('app.leave.chart_description')}</caption>
							<thead class="text-muted-foreground">
								<tr>
									<th class="w-14 pb-1 text-left font-medium">{t('app.leave.heatmap_year')}</th>
									{#each Array.from({ length: 12 }, (_value, index) => index + 1) as month}
										<th class="pb-1 font-medium" scope="col">{month}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each analytics.seasonal_heatmap as row (row.year)}
									<tr>
										<th class="pr-1 text-left font-medium tabular-nums" scope="row">{row.year}</th>
										{#each row.months as count, monthIndex (`${row.year}-${monthIndex}`)}
											<td>
												<span
													class="block rounded-sm py-2 font-medium tabular-nums {heatmapClass(
														count
													)}"
													title={t('app.leave.heatmap_cell', {
														year: row.year,
														month: monthIndex + 1,
														count
													})}
												>
													{count}
												</span>
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
						<Inline justify="end" gap="xs" aria-label={t('app.leave.heatmap_legend')}>
							<span class="text-xs text-muted-foreground">{t('app.leave.heatmap_fewer')}</span>
							{#each [1, 2, 3, 4, 5] as level}
								<span
									class="size-3 rounded-sm {heatmapClass(
										Math.max(1, Math.ceil((heatmapMaximum * level) / 5))
									)}"
								></span>
							{/each}
							<span class="text-xs text-muted-foreground">{t('app.leave.heatmap_more')}</span>
						</Inline>
					{/if}
				</Stack>
			</div>
		</Stack>
	{/if}
{/snippet}

{#snippet requests()}
	{#if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.leave.loading_company_scope')}</span>
		</Inline>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.leave.empty_requests')}</p>
	{:else}
		<CollectionTable
			{client}
			collection="leave_requests"
			view={`hr_controller:leave:requests:${selectedCompanyId}`}
			query={{
				where: {
					leave_request_employment: {
						norbital_approval_id: { isNull: true },
						company_id: { eq: selectedCompanyId }
					}
				},
				orderBy: { from_date: 'desc' },
				with: {
					leave_request_type: { columns: { code: true, name: true } },
					leave_request_employment: { columns: { employee_number: true } }
				}
			}}
			searchPlaceholder={t('app.leave.search_requests')}
		>
			{#snippet columns({ Column })}
				<Column
					name="leave_type_id"
					label={t('component.leave_type')}
					card="title"
					render={({ row }) => leaveTypeLabel(row)}
				/>
				<Column
					name="employment_id"
					label={t('component.employment')}
					card="subtitle"
					render={({ row }) => employmentLabel(row)}
				/>
				<Column
					name="event"
					label={t('component.leave_range')}
					render={({ row }) => leaveRangeLabel(row)}
				/>
				<Column name="kind" label={t('component.event')} card="badge" />
				<Column
					name="days"
					label={t('component.days')}
					render={({ value }) => formatNumeric(value)}
				/>
				<Column
					name="certificate_file"
					label={t('component.certificate')}
					render={({ value }) => (value == null || value === '' ? '—' : t('app.leave.attached'))}
				/>
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet types()}
	{#if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.leave.loading_company_scope')}</span>
		</Inline>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.leave.empty_types')}</p>
	{:else}
		<CollectionTable
			{client}
			collection="leave_types"
			view={`hr_controller:leave:types:${selectedCompanyId}`}
			initialFilters={inForceTodayFilter()}
			query={{
				where: {
					company_id: { eq: selectedCompanyId }
				},
				orderBy: { code: 'asc' }
			}}
			searchPlaceholder={t('app.leave.search_types')}
		>
			{#snippet columns({ Column })}
				<Column name="code" card="title" />
				<Column name="name" card="subtitle" />
				<Column
					name="accrual"
					label={t('app.leave.accrual')}
					render={({ value }) => formatLeaveAccrual(value, t)}
				/>
				<Column name="entitlement" label={t('app.leave.entitlement_matrix')} />
				<Column
					name="payroll_effect"
					label={t('app.leave.payroll_effect')}
					render={({ value }) => formatLeavePayrollEffect(value, t)}
				/>
				<Column name="encash_on_exit" label={t('app.leave.encash_on_exit')} />
				<Column name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'overview',
				label: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				content: overview
			},
			{
				name: 'requests',
				label: t('app.leave.tab_requests'),
				icon: 'lucide:calendar-check-2',
				content: requests
			},
			{
				name: 'types',
				label: t('app.leave.tab_types'),
				icon: 'lucide:palmtree',
				content: types
			}
		] satisfies TabConfig[]}
	/>
</Cover>
