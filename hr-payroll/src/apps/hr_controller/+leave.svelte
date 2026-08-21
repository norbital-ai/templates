<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
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
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

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
	/**
	 * The leave requests the requests table renders, read once for their ids so the settlement
	 * claims over them can be scoped (the table owns its own query, so this read is the lock's half
	 * of the contract: the row lock and the write hook must compute the same claim).
	 */
	const leaveRequestsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_requests.findMany({
					where: { leave_request_employment: { company_id: { eq: selectedCompanyId } } },
					columns: { norbital_id: true },
					limit: 5000
				})
	);
	const leaveSettlementsQuery = $derived.by(() => {
		const ids = (leaveRequestsQuery?.current ?? []).map((row) => row.norbital_id);
		if (ids.length === 0) return null;
		return client.db.payslip_sources.findMany({
			where: { leave_request_id: { in: ids } },
			columns: { leave_request_id: true, period: true },
			limit: 5000
		});
	});
	const settlementByRequestId = $derived(
		new Map(
			(leaveSettlementsQuery?.current ?? []).map((claim) => [
				claim.leave_request_id,
				{ period: claim.period }
			])
		)
	);

	type LeaveRequestRow = WorkspaceRow<'leave_requests'> & {
		readonly leave_request_type?: Pick<WorkspaceRow<'leave_types'>, 'code' | 'name'> | null;
		readonly leave_request_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
	};

	/**
	 * The one-lock rule on a leave request: only a payslip that consumed it freezes it.
	 *
	 * Approval and passed dates used to freeze leave here and in `leave_requests/+hooks.ts`; both
	 * stopped, so this table's locks and the hook's refusals agree that a request is held only by a
	 * `payslip_sources` claim — which names the period that holds it. The day-shaped guard is still
	 * alive, but on the create side only: `normalizedTimeOff` refuses a *new* range touching days a
	 * paid run already priced.
	 */
	function leaveRowLock(row: WorkspaceRow<'leave_requests'>) {
		return sourceLock({
			existing: true,
			approvalId: row.norbital_approval_id,
			dates: [],
			settledBy: settlementByRequestId.get(row.norbital_id) ?? null,
			datePassed: 'IS_NOT_A_LOCK'
		});
	}

	function leaveTypeLabel(row: LeaveRequestRow): string {
		const leaveType = row.leave_request_type;
		if (leaveType?.code && leaveType.name) return `${leaveType.code} · ${leaveType.name}`;
		if (leaveType?.code) return leaveType.code;
		return '—';
	}

	function employmentLabel(row: LeaveRequestRow): string {
		return row.leave_request_employment?.employee_number ?? '—';
	}

	function leaveRangeLabel(event: LeaveEvent | null | undefined): string {
		if (event == null || event.kind !== 'TIME_OFF') return '—';
		const half = (value: 'FIRST' | 'SECOND') =>
			value === 'FIRST' ? t('component.first_half') : t('component.second_half');
		return `${formatCalendarDate(event.range.start.date)}, ${half(event.range.start.half)} → ${formatCalendarDate(event.range.end.date)}, ${half(event.range.end.half)}`;
	}
</script>

<svelte:head>
	<title>Leave</title>
	<meta name="description" content="Review leave events and the leave types that entitle them" />
	<meta name="bolt:icon" content="lucide:calendar-check-2" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
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
				recordMetadata={(row) => sourceLockRecordMetadata(leaveRowLock(row), t)}
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
						render={({ row }) => leaveRangeLabel(row.event)}
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
