<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { relatedPayslipInputs } from '../../lib/payslip-source-query.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Effect } from 'effect';
	import { getErrorMessage } from '@norbital-ai/std';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { decodeNumber } from '@norbital-ai/std/json';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Alert, AlertDescription } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { Bound, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import {
		formatCalendarDate,
		formatLeaveAccrual,
		formatLeavePayrollEffect,
		formatLeaveRange,
		formatNumeric
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayKey } from '../../lib/ui/calendar.js';
	import LeaveSeasonality from '../../lib/ui/leave/leave-seasonality.svelte';
	import { leaveYearSummary, ledgerRowOf } from '../../collections/payroll_runs/lib/leave.js';
	import {
		resolveEntitlementAt,
		type ChildFact
	} from '../../collections/payroll_runs/lib/leave.js';
	import { sealedProfileCovering, statutoryProfileLineage } from '../../lib/statutory_profile.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	const today = todayKey();

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

	/* ── Balances: the same row per person the employee reads, for every employment ── */

	const balanceCompanyQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.companies.findFirst({
					where: { id: { eq: selectedCompanyId } },
					columns: { id: true, name: true, jurisdiction_id: true, leave_year_start_month: true }
				})
	);
	const balanceEmploymentsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.employments.findMany({
					where: { company_id: { eq: selectedCompanyId }, approval_id: { isNull: true } },
					columns: {
						id: true,
						employee_id: true,
						employee_number: true,
						hire_date: true,
						exit_date: true
					},
					orderBy: { employee_number: 'asc' },
					limit: 1_000
				})
	);
	const balanceEmployments = $derived(balanceEmploymentsQuery?.current ?? []);
	const balanceEmployeeIds = $derived([
		...new Set(balanceEmployments.map((employment) => employment.employee_id))
	]);
	const balanceEmploymentIds = $derived(balanceEmployments.map((employment) => employment.id));
	const balanceEmployeesQuery = $derived(
		balanceEmployeeIds.length === 0
			? null
			: client.db.employees.findMany({
					where: { id: { in: balanceEmployeeIds } },
					columns: { id: true, name: true },
					limit: 1_000
				})
	);
	const balanceEmployeeNameById = $derived(
		new Map((balanceEmployeesQuery?.current ?? []).map((employee) => [employee.id, employee.name]))
	);
	const balanceTypesQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_types.findMany({
					where: { company_id: { eq: selectedCompanyId }, approval_id: { isNull: true } },
					orderBy: { code: 'asc' },
					limit: 200
				})
	);
	const balanceLedgerQuery = $derived(
		balanceEmploymentIds.length === 0
			? null
			: client.db.leave_requests.findMany({
					where: { employment_id: { in: balanceEmploymentIds } },
					columns: {
						id: true,
						approval_id: true,
						employment_id: true,
						leave_type_id: true,
						from_date: true,
						kind: true,
						days: true,
						event: true
					},
					limit: 10_000
				})
	);
	const balanceChildrenQuery = $derived(
		balanceEmploymentIds.length === 0
			? null
			: client.db.employee_children.findMany({
					where: { employment_id: { in: balanceEmploymentIds }, approval_id: { isNull: true } },
					limit: 10_000
				})
	);
	const balanceAnchorQuery = $derived(
		balanceCompanyQuery?.current?.jurisdiction_id == null
			? null
			: client.db.jurisdictions.findFirst({
					where: { id: { eq: balanceCompanyQuery.current.jurisdiction_id } },
					columns: { code: true }
				})
	);
	const balanceProfilesQuery = $derived(
		balanceAnchorQuery?.current?.code == null
			? null
			: client.db.jurisdictions.findMany({
					where: {
						code: { eq: balanceAnchorQuery.current.code },
						lifecycle: { eq: 'SEALED' },
						approval_id: { isNull: true }
					},
					limit: 100
				})
	);
	const balanceProfile = $derived.by(() => {
		const rows = balanceProfilesQuery?.current;
		if (rows == null || rows.length === 0 || balanceAnchorQuery?.current?.code == null) return null;
		return sealedProfileCovering(rows, balanceAnchorQuery.current.code, today);
	});
	const balanceLedgerRows = $derived(
		(balanceLedgerQuery?.current ?? []).flatMap((row) => {
			const entry = ledgerRowOf(row);
			return entry == null ? [] : [{ ...entry, employment_id: row.employment_id }];
		})
	);
	const balancePersonRowsResult = $derived.by(() => {
		try {
			const profile = balanceProfile;
			const company = balanceCompanyQuery?.current;
			const types = balanceTypesQuery?.current;
			if (profile == null || company == null || types == null) return { rows: [], error: null };
			const yearStart = decodeNumber(company.leave_year_start_month);
			const ledgerByEmployment = new Map<string, typeof balanceLedgerRows>();
			for (const row of balanceLedgerRows) {
				const bucket = ledgerByEmployment.get(row.employment_id) ?? [];
				bucket.push(row);
				ledgerByEmployment.set(row.employment_id, bucket);
			}
			const childrenByEmployment = new Map<string, ChildFact[]>();
			for (const child of balanceChildrenQuery?.current ?? []) {
				const bucket = childrenByEmployment.get(child.employment_id) ?? [];
				bucket.push(child);
				childrenByEmployment.set(child.employment_id, bucket);
			}
			return {
				rows: balanceEmployments.flatMap((employment) => {
					const hire = formatDateISO(employment.hire_date) || today;
					const exit =
						employment.exit_date == null ? null : (formatDateISO(employment.exit_date) ?? null);
					return types
						.filter((type) =>
							statutoryProfileLineage(balanceProfilesQuery?.current ?? [], profile).some(
								(entry) => entry.id === type.statutory_profile_id
							)
						)
						.map((type) => ({
							employment,
							type,
							summary: leaveYearSummary(
								{
									leaveType: type,
									entitlementAt: (serviceMonths: number, asOf: string) =>
										resolveEntitlementAt({
											leaveType: type,
											profiles: balanceProfilesQuery?.current ?? [],
											jurisdictionCode: profile.code,
											children: childrenByEmployment.get(employment.id) ?? [],
											serviceMonths,
											employmentId: employment.id,
											asOf
										}),
									hireDate: hire,
									exitDate: exit,
									leaveYearStartMonth: yearStart,
									ledger: (ledgerByEmployment.get(employment.id) ?? []).filter(
										(row) => row.leave_type_id === type.id
									),
									basis: 'SETTLED' as const
								},
								today
							)
						}));
				}),
				error: null
			};
		} catch (cause) {
			return { rows: [], error: getErrorMessage(cause) };
		}
	});
	const balancePersonRows = $derived(balancePersonRowsResult.rows);

	/* ── Year-end: the last processed year, its posted fact, and the button for the next ── */

	const carryRowsQuery = $derived(
		balanceEmploymentIds.length === 0
			? null
			: client.db.leave_requests.findMany({
					where: {
						employment_id: { in: balanceEmploymentIds },
						kind: { eq: 'CARRY_FORWARD' }
					},
					columns: { id: true, employment_id: true, leave_type_id: true, event: true },
					limit: 10_000
				})
	);
	const yearEndGroups = $derived.by(() => {
		const groups = new Map<
			number,
			{ year: number; rows: number; carried: number; forfeited: number; negatives: number }
		>();
		for (const row of carryRowsQuery?.current ?? []) {
			if (row.event?.kind !== 'CARRY_FORWARD' || typeof row.event.leave_year !== 'number') continue;
			const year = row.event.leave_year;
			const group = groups.get(year) ?? { year, rows: 0, carried: 0, forfeited: 0, negatives: 0 };
			group.rows += 1;
			group.carried += typeof row.event.movement_days === 'number' ? row.event.movement_days : 0;
			group.forfeited +=
				typeof row.event.forfeited_days === 'number' ? row.event.forfeited_days : 0;
			if (typeof row.event.closing?.closing === 'number' && row.event.closing.closing < 0)
				group.negatives += 1;
			groups.set(year, group);
		}
		return [...groups.values()].toSorted((left, right) => right.year - left.year);
	});
	const lastProcessedYear = $derived(yearEndGroups[0]?.year ?? null);
	let nextYearInput = $state<string>('');
	const nextYear = $derived.by(() => {
		const parsed = decodeNumber(nextYearInput);
		if (nextYearInput.trim() !== '' && Number.isInteger(parsed)) return parsed;
		if (lastProcessedYear != null) return lastProcessedYear + 1;
		return Number(today.slice(0, 4));
	});
	let yearEndPending = $state(false);
	let yearEndError = $state<string | null>(null);
	type YearEndResult = {
		readonly state: 'created' | 'existing';
		readonly rows_written: number;
		readonly total_carried_days: number;
		readonly total_forfeited_days: number;
		readonly negative_closings: readonly { readonly employee_number?: unknown }[];
	};
	let yearEndResult = $state<YearEndResult | null>(null);

	/**
	 * The posted `CARRY_FORWARD` rows are the record of who was closed and when: the event stream
	 * carries no actor column, so "who ran it" is the posted fact itself — the year, its row
	 * count and its totals — plus the last invocation result below while this session holds it.
	 */
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

{#snippet allocations()}
	{#if selectedCompanyId != null}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('app.leave.allocations_description')}</p>
			<CollectionTable
				{client}
				collection="leave_allocations"
				view={`hr_controller:leave:allocations:${selectedCompanyId}`}
				query={{
					where: { allocation_employment: { some: { company_id: { eq: selectedCompanyId } } } },
					orderBy: { expires_on: 'asc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column name="event_reference" card="title" />
					<Column name="employment_id" />
					<Column name="leave_type_id" />
					<Column name="allocated_days" />
					<Column name="starts_on" />
					<Column name="expires_on" />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet balances()}
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
		<Bound size="full">
			<Scroll name="Leave balances">
				<Stack gap="md">
					<Stack gap="none">
						<h2 class="text-heading">{t('app.leave.balances_title')}</h2>
						<p class="text-sm text-muted-foreground">
							{t('app.leave.balances_description', { date: formatCalendarDate(today) })}
						</p>
					</Stack>
					{#if balancePersonRowsResult.error != null}
						<Alert variant="destructive"
							><AlertDescription>{balancePersonRowsResult.error}</AlertDescription></Alert
						>
					{:else if balancePersonRows.length === 0}
						<p class="text-sm text-muted-foreground">{t('app.leave.balances_empty')}</p>
					{:else}
						<div class="overflow-x-auto rounded-xl border bg-card shadow-sm">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b bg-muted/30 text-left">
										<th class="px-4 py-2 font-medium">{t('component.employment')}</th>
										<th class="px-4 py-2 font-medium">{t('component.leave_type')}</th>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_entitlement')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_earned')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_carried')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_adjustments')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_taken')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_pending')}</th
										>
										<th class="px-4 py-2 text-right font-medium tabular-nums"
											>{t('app.hr_employee.leave_balance')}</th
										>
									</tr>
								</thead>
								<tbody>
									{#each balancePersonRows as row (row.employment.id + row.type.id)}
										<tr class="border-b last:border-0">
											<td class="px-4 py-2">
												{balanceEmployeeNameById.get(row.employment.employee_id) ?? '—'}
												<span class="text-muted-foreground">· {row.employment.employee_number}</span
												>
											</td>
											<td class="px-4 py-2">{row.type.code}</td>
											{#if row.type.accrual?.kind === 'PER_EVENT'}
												<td class="px-4 py-2 text-muted-foreground" colspan="7">
													{t('app.hr_employee.leave_per_event_taken', {
														days: formatNumeric(row.summary.taken)
													})}
												</td>
											{:else}
												<td class="px-4 py-2 text-right tabular-nums"
													>{formatNumeric(row.summary.entitlement)}</td
												>
												<td class="px-4 py-2 text-right tabular-nums"
													>{row.type.accrual?.kind === 'MONTHLY'
														? formatNumeric(row.summary.earned)
														: '—'}</td
												>
												<td class="px-4 py-2 text-right tabular-nums">
													{formatNumeric(row.summary.carry.days)}
													{#if row.summary.carry.expires_on != null}
														<span class="text-muted-foreground">
															· {t('app.hr_employee.leave_carry_use_by', {
																date: formatCalendarDate(row.summary.carry.expires_on)
															})}
														</span>
													{/if}
													{#if row.summary.carry.state === 'PROVISIONAL' && row.summary.carry.days > 0}
														<span class="text-warning-foreground">
															· {t('app.hr_employee.leave_carry_pending', {
																year: row.summary.year - 1
															})}
														</span>
													{/if}
												</td>
												<td class="px-4 py-2 text-right tabular-nums"
													>{formatNumeric(row.summary.adjusted)}</td
												>
												<td class="px-4 py-2 text-right tabular-nums"
													>{formatNumeric(row.summary.taken)}</td
												>
												<td class="px-4 py-2 text-right tabular-nums"
													>{formatNumeric(row.summary.pending)}</td
												>
												<td class="px-4 py-2 text-right font-medium tabular-nums"
													>{formatNumeric(row.summary.balance)}</td
												>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Stack>
			</Scroll>
		</Bound>
	{/if}
{/snippet}

{#snippet yearend()}
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
		<Bound size="full">
			<Scroll name="Leave year-end">
				<Stack gap="md">
					<Stack gap="none">
						<h2 class="text-heading">{t('app.leave.yearend_title')}</h2>
						<p class="text-sm text-muted-foreground">{t('app.leave.yearend_description')}</p>
					</Stack>
					{#if lastProcessedYear == null}
						<p class="text-sm text-muted-foreground">{t('app.leave.yearend_never')}</p>
					{:else}
						<Inline gap="sm" align="center">
							<Badge>
								{t('app.leave.yearend_last', {
									year: lastProcessedYear,
									rows: yearEndGroups[0]?.rows ?? 0,
									carried: formatNumeric(yearEndGroups[0]?.carried ?? 0),
									forfeited: formatNumeric(yearEndGroups[0]?.forfeited ?? 0)
								})}
							</Badge>
							{#if (yearEndGroups[0]?.negatives ?? 0) > 0}
								<Badge variant="outline">
									{t('app.leave.yearend_negatives', { count: yearEndGroups[0]?.negatives ?? 0 })}
								</Badge>
							{/if}
						</Inline>
					{/if}
					<Inline gap="sm" align="end">
						<label class="text-sm font-medium">
							<Stack gap="xs">
								{t('app.leave.yearend_next')}
								<Input
									type="number"
									class="w-28"
									value={nextYearInput}
									placeholder={String(nextYear)}
									oninput={(event) => (nextYearInput = event.currentTarget.value)}
								/>
							</Stack>
						</label>
						<Button
							size="sm"
							disabled={yearEndPending}
							onclick={() => {
								if (selectedCompanyId == null || yearEndPending) return;
								const companyId = selectedCompanyId;
								const leaveYear = nextYear;
								yearEndPending = true;
								yearEndError = null;
								yearEndResult = null;
								Effect.runFork(
									Effect.tryPromise({
										try: () =>
											client.invoke.process_leave_year({
												company_id: companyId,
												leave_year: leaveYear
											}),
										catch: (cause) => cause
									}).pipe(
										Effect.tap((result) =>
											Effect.sync(() => {
												yearEndResult = result as YearEndResult;
											})
										),
										Effect.catch((cause) =>
											Effect.sync(() => {
												yearEndError = getErrorMessage(cause);
											})
										),
										Effect.ensuring(Effect.sync(() => (yearEndPending = false)))
									)
								);
							}}
						>
							{yearEndPending
								? t('app.leave.yearend_running')
								: t('app.leave.yearend_run', { year: nextYear })}
						</Button>
					</Inline>
					{#if yearEndError != null}
						<p class="text-sm text-destructive">{yearEndError}</p>
					{/if}
					{#if yearEndResult != null}
						<p class="text-sm text-muted-foreground">
							{t('app.leave.yearend_result', {
								state: yearEndResult.state,
								rows: yearEndResult.rows_written,
								carried: formatNumeric(yearEndResult.total_carried_days),
								forfeited: formatNumeric(yearEndResult.total_forfeited_days),
								negatives: yearEndResult.negative_closings.length
							})}
						</p>
					{/if}
				</Stack>
			</Scroll>
		</Bound>
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
			},
			{
				name: 'balances',
				label: t('app.leave.tab_balances'),
				icon: 'lucide:scale',
				content: balances
			},
			{
				name: 'allocations',
				label: t('app.leave.tab_allocations'),
				icon: 'lucide:calendar-check',
				content: allocations
			},
			{
				name: 'yearend',
				label: t('app.leave.tab_yearend'),
				icon: 'lucide:calendar-clock',
				content: yearend
			}
		] satisfies TabConfig[]}
	/>
</Cover>
