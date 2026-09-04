<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { relatedPayslipInputs } from '../../lib/payslip-source-query.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { Bound, Cover, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import {
		formatLeaveAccrual,
		formatLeavePayrollEffect,
		formatLeaveRange
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';
	import LeaveSeasonality from '../../lib/ui/leave/leave-seasonality.svelte';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();

	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	const companiesError = $derived(companiesErrorOf());
	/**
	 * The leave requests the requests table renders, read once for their ids so the settlement
	 * claims over them can be scoped (the table owns its own query, so this read is the lock's half
	 * of the contract: the row lock and the write hook must compute the same claim).
	 */
	const leaveRequestsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_requests.findMany({
					where: {
						leave_request_employment: { some: { company_id: { eq: selectedCompanyId } } }
					},
					columns: { id: true },
					limit: 10_000
				})
	);
	const leaveSettlementsQuery = $derived(
		relatedPayslipInputs(leaveRequestsQuery, 'leave_request_id', (query) =>
			client.db.payslip_leave_request_inputs.findMany(query)
		)
	);
	const settlementByRequestId = $derived(
		new Map(
			(leaveSettlementsQuery?.current ?? []).map((capture) => [
				capture.leave_request_id,
				{ period: capture.period }
			])
		)
	);

	type LeaveRequestRow = WorkspaceRow<'leave_requests'> & {
		readonly leave_request_type?: Pick<WorkspaceRow<'leave_types'>, 'id' | 'code' | 'name'> | null;
		readonly leave_request_employment?: Pick<
			WorkspaceRow<'employments'>,
			'id' | 'employee_number'
		> | null;
	};

	/**
	 * The one-lock rule on a leave request: only a payslip that consumed it freezes it.
	 *
	 * Approval and passed dates used to freeze leave here and in `leave_requests/+hooks.ts`; both
	 * stopped, so this table's locks and the hook's refusals agree that a request is held only by a
	 * `payslip_adjustments` claim — which names the period that holds it. The day-shaped guard is still
	 * alive, but on the create side only: `normalizedTimeOff` refuses a *new* range touching days a
	 * paid run already priced.
	 */
	function leaveRowLock(row: WorkspaceRow<'leave_requests'>) {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: settlementByRequestId.get(row.id) ?? null,
			datePassed: 'IS_NOT_A_LOCK'
		});
	}

	function leaveTypeLabel(row: LeaveRequestRow): string {
		const leaveType = row.leave_request_type;
		if (leaveType?.code && leaveType.name) return `${leaveType.code} · ${leaveType.name}`;
		if (leaveType?.code) return leaveType.code;
		return '—';
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
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

{#snippet overview()}
	<Bound size="full">
		<Scroll name="Leave overview">
			{#if companiesError}
				<p class="py-8 text-center text-sm text-destructive">{companiesError.message}</p>
			{:else if companiesUnknown}
				<Inline
					justify="center"
					align="center"
					gap="sm"
					class="min-h-48 text-sm text-muted-foreground"
				>
					<Spinner class="size-4" />
					<span>{t('app.hr_controller.loading_scope')}</span>
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
	{#if companiesError}
		<p class="py-8 text-center text-sm text-destructive">{companiesError.message}</p>
	{:else if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.hr_controller.loading_scope')}</span>
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
							some: {
								approval_id: { isNull: true },
								company_id: { eq: selectedCompanyId }
							}
						}
					},
					orderBy: { from_date: 'desc' },
					with: {
						leave_request_type: { columns: { id: true, code: true, name: true } },
						leave_request_employment: { columns: { id: true, employee_number: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="leave_type_id"
						label={t('component.leave_type')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => leaveTypeLabel(row) }}
					/>
					<Column
						name="employment_id"
						label={t('component.employment')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: LeaveRequestRow }) =>
								row.leave_request_employment?.employee_number ?? '—'
						}}
					/>
					<Column
						name="event"
						label={t('component.leave_range')}
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => formatLeaveRange(row.event, t) }}
					/>
					<Column name="kind" label={t('component.event')} card="badge" />
					<Column name="days" label={t('component.days')} />
					<Column
						name="certificate_file"
						label={t('component.certificate')}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ value }) => (value == null || value === '' ? '—' : t('app.leave.attached'))
						}}
					/>
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

{#snippet types()}
	{#if companiesError}
		<p class="py-8 text-center text-sm text-destructive">{companiesError.message}</p>
	{:else if companiesUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('app.hr_controller.loading_scope')}</span>
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
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ value }) => formatLeaveAccrual(value, t) }}
					/>
					<Column name="entitlement" label={t('app.leave.entitlement_matrix')} />
					<Column
						name="payroll_effect"
						label={t('app.leave.payroll_effect')}
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ value }) => formatLeavePayrollEffect(value, t) }}
					/>
					<Column name="encash_on_exit" label={t('app.leave.encash_on_exit')} />
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
