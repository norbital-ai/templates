<script lang="ts">
	import { client } from '$pod/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/pod/client/app-header-actions';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Bound, Cover, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import {
		formatCalendarDate,
		formatLeaveAccrual,
		formatLeavePayrollEffect,
		formatNumeric
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';
	import LeaveSeasonality from '../../lib/ui/leave/leave-seasonality.svelte';

	const { t } = useI18n<TenantI18nKeys>();

	let requestedCompanyId = $state<string | null>(null);
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
	const companiesUnknown = $derived(companiesQuery.loading && companiesQuery.current === undefined);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.norbital_id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companies.some((company) => company.norbital_id === requestedCompanyId)
			? requestedCompanyId
			: (companies[0]?.norbital_id ?? null)
	);

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
				requestedCompanyId = value;
				return;
			}
			requestedCompanyId = companies[0]?.norbital_id ?? null;
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
	<Bound size="full">
		<Scroll name="Leave overview">
			{#if companiesQuery.error && companiesQuery.current === undefined}
				<p class="py-8 text-center text-sm text-destructive">{companiesQuery.error.message}</p>
			{:else if companiesUnknown}
				<Inline
					justify="center"
					align="center"
					gap="sm"
					class="min-h-48 text-sm text-muted-foreground"
				>
					<Spinner class="size-4" />
					<span>{t('app.leave.loading_company_scope')}</span>
				</Inline>
			{:else if selectedCompanyId == null}
				<p class="text-sm text-muted-foreground">{t('app.leave.empty_overview')}</p>
			{:else}
				{#key selectedCompanyId}
					<LeaveSeasonality companyId={selectedCompanyId} />
				{/key}
			{/if}
		</Scroll>
	</Bound>
{/snippet}

{#snippet requests()}
	{#if companiesQuery.error && companiesQuery.current === undefined}
		<p class="py-8 text-center text-sm text-destructive">{companiesQuery.error.message}</p>
	{:else if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.leave.loading_company_scope')}</span>
		</Inline>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.leave.empty_requests')}</p>
	{:else}
		{#key selectedCompanyId}
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
		{/key}
	{/if}
{/snippet}

{#snippet types()}
	{#if companiesQuery.error && companiesQuery.current === undefined}
		<p class="py-8 text-center text-sm text-destructive">{companiesQuery.error.message}</p>
	{:else if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.leave.loading_company_scope')}</span>
		</Inline>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.leave.empty_types')}</p>
	{:else}
		{#key selectedCompanyId}
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
		{/key}
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
