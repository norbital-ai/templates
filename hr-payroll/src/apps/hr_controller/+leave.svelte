<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { Bound, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import type { WorkspaceRow } from '$bolt/types.js';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { relatedPayslipInputs } from '../../lib/payslip-source-query.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { leaveAccountSummary } from '../../lib/leave/ledger.js';
	import { measuredLeaveRequestDays } from '../../lib/leave/pending.js';
	import { decodeNumber } from '@norbital-ai/std/json';

	const { t } = useI18n<TenantI18nKeys>();
	const LIVE_QUERY_LIMIT = 10_000;
	const PENDING_LEAVE_LIMIT = 2_000;
	const today = todayKey();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	const companiesError = $derived(companiesErrorOf());

	const employmentsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.employments.findMany({
					where: { company_id: { eq: selectedCompanyId }, approval_id: { isNull: true } },
					columns: { id: true, employee_id: true, employee_number: true },
					limit: LIVE_QUERY_LIMIT
				})
	);
	const employments = $derived(employmentsQuery?.current ?? []);
	const employmentIds = $derived(employments.map((row) => row.id));
	const employeeIds = $derived([...new Set(employments.map((row) => row.employee_id))]);
	const employeesQuery = $derived(
		employeeIds.length === 0
			? null
			: client.db.employees.findMany({
					where: { id: { in: employeeIds } },
					columns: { id: true, name: true },
					limit: LIVE_QUERY_LIMIT
				})
	);
	const employeeNameById = $derived(
		new Map((employeesQuery?.current ?? []).map((row) => [row.id, row.name]))
	);
	const employmentById = $derived(new Map(employments.map((row) => [row.id, row])));

	const accountsQuery = $derived(
		employmentIds.length === 0
			? null
			: client.db.leave_accounts.findMany({
					where: {
						employment_id: { in: employmentIds },
						approval_id: { isNull: true },
						status: { eq: 'OPEN' },
						starts_on: { lte: today },
						ends_on: { gte: today }
					},
					orderBy: { starts_on: 'desc' },
					limit: LIVE_QUERY_LIMIT
				})
	);
	const accounts = $derived(accountsQuery?.current ?? []);
	const accountIds = $derived(accounts.map((row) => row.id));
	const entriesQuery = $derived(
		accountIds.length === 0
			? null
			: client.db.leave_entries.findMany({
					where: { leave_account_id: { in: accountIds }, approval_id: { isNull: true } },
					orderBy: { effective_on: 'desc' },
					limit: LIVE_QUERY_LIMIT
				})
	);
	const entries = $derived(entriesQuery?.current ?? []);
	const pendingQuery = $derived(
		employmentIds.length === 0
			? null
			: client.pending.findMany('leave_requests', {
					where: { employment_id: { in: employmentIds } },
					limit: PENDING_LEAVE_LIMIT
				})
	);
	const pendingRows = $derived(pendingQuery?.current ?? []);
	const pendingAtSafetyCeiling = $derived(pendingRows.length >= PENDING_LEAVE_LIMIT);
	const balancesAtSafetyCeiling = $derived(
		employments.length >= LIVE_QUERY_LIMIT ||
			accounts.length >= LIVE_QUERY_LIMIT ||
			entries.length >= LIVE_QUERY_LIMIT
	);
	const balanceRows = $derived.by(() =>
		pendingAtSafetyCeiling || balancesAtSafetyCeiling
			? []
			: accounts
					.filter(
						(account) =>
							account.status === 'OPEN' &&
							today >= String(account.starts_on).slice(0, 10) &&
							today <= String(account.ends_on).slice(0, 10)
					)
					.map((account) => {
						const employment = employmentById.get(account.employment_id);
						const pending = pendingRows
							.filter((row) => row.leave_account_id === account.id && row.approval_id != null)
							.reduce((total, row) => total + measuredLeaveRequestDays(row), 0);
						return {
							account,
							employment,
							name:
								employment == null
									? '—'
									: (employeeNameById.get(employment.employee_id) ?? employment.employee_number),
							summary: leaveAccountSummary({
								account,
								entries: entries.filter((entry) => entry.leave_account_id === account.id),
								pendingDays: pending,
								asOf: today
							})
						};
					})
					.toSorted(
						(left, right) =>
							left.name.localeCompare(right.name) ||
							left.account.leave_code.localeCompare(right.account.leave_code)
					)
	);
	const totalAvailable = $derived(
		balanceRows
			.filter((row) => row.account.accrual_kind !== 'UNLIMITED')
			.reduce((total, row) => total + row.summary.available, 0)
	);
	const expiringCarry = $derived(
		entries.filter(
			(entry) =>
				entry.kind === 'CARRY_FORWARD' &&
				entry.expires_on != null &&
				String(entry.expires_on).slice(0, 10) >= today
		).length
	);

	const requestIdsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_requests.findMany({
					where: { leave_request_employment: { some: { company_id: { eq: selectedCompanyId } } } },
					columns: { id: true },
					limit: LIVE_QUERY_LIMIT
				})
	);
	const capturesQuery = $derived(
		relatedPayslipInputs(requestIdsQuery, 'leave_request_id', (query) =>
			client.db.payslip_leave_request_inputs.findMany(query)
		)
	);
	const captureByRequest = $derived(
		new Map(
			(capturesQuery?.current ?? []).map((capture) => [
				capture.leave_request_id,
				{ period: capture.period }
			])
		)
	);
	function requestMetadata(row: WorkspaceRow<'leave_requests'>) {
		return sourceLockRecordMetadata(
			sourceLock({
				existing: true,
				approvalId: row.approval_id,
				dates: [],
				settledBy: captureByRequest.get(row.id) ?? null,
				datePassed: 'IS_NOT_A_LOCK'
			}),
			t
		);
	}

	const loading = $derived(
		companiesUnknown ||
			accountsQuery?.loading === true ||
			entriesQuery?.loading === true ||
			employmentsQuery?.loading === true ||
			pendingQuery?.loading === true
	);
	const queryError = $derived(
		employmentsQuery?.error ??
			employeesQuery?.error ??
			accountsQuery?.error ??
			entriesQuery?.error ??
			pendingQuery?.error ??
			null
	);
</script>

<svelte:head>
	<title>Leave</title>
	<meta name="description" content="Leave plans, generated accounts, applications and ledger" />
	<meta name="bolt:icon" content="lucide:calendar-check-2" />
</svelte:head>

{#snippet scopePicker()}
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

{#snippet overview()}
	<Bound size="full">
		<Scroll name="Leave balances">
			{#if companiesError != null}
				<p class="p-6 text-sm text-destructive">{companiesError.message}</p>
			{:else if queryError != null}
				<p role="alert" class="p-6 text-sm text-destructive">{queryError.message}</p>
			{:else if loading}
				<Inline justify="center" align="center" gap="sm" class="min-h-48 text-muted-foreground">
					<Spinner class="size-4" /> Loading leave accounts
				</Inline>
			{:else if selectedCompanyId == null}
				<p class="p-6 text-sm text-muted-foreground">Choose a legal entity.</p>
			{:else if balancesAtSafetyCeiling}
				<p class="p-6 text-sm text-destructive">
					The current account or ledger window reached its 10,000-row safety ceiling. Balances are
					hidden because a partial ledger cannot produce a trustworthy total; narrow the company
					scope.
				</p>
			{:else if pendingAtSafetyCeiling}
				<p class="p-6 text-sm text-destructive">
					Pending leave reached the 2,000-row safety ceiling. Balances are hidden because the
					remaining amount cannot be calculated safely; settle pending requests or narrow the
					company scope.
				</p>
			{:else}
				<Stack gap="md">
					<header class="flex flex-wrap items-end justify-between gap-4 border-b pb-3">
						<div>
							<h2 class="text-heading">Current balances</h2>
							<p class="text-sm text-muted-foreground">
								Posted ledger entries minus held applications.
							</p>
						</div>
						<dl class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
							<div>
								<dt class="text-meta">Open accounts</dt>
								<dd class="font-medium tabular-nums text-foreground">{balanceRows.length}</dd>
							</div>
							<div>
								<dt class="text-meta">Available days</dt>
								<dd class="font-medium tabular-nums text-foreground">
									{formatNumeric(totalAvailable)}
								</dd>
							</div>
							<div>
								<dt class="text-meta">Expiring carry</dt>
								<dd class="font-medium tabular-nums text-foreground">{expiringCarry}</dd>
							</div>
						</dl>
					</header>

					<div class="overflow-x-auto rounded-xl bg-card shadow-sm">
						<table class="w-full text-sm">
							<thead class="border-b bg-muted/40 text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-4 py-3 font-medium">Person</th>
									<th class="px-4 py-3 font-medium">Leave</th>
									<th class="px-3 py-3 text-right font-medium">Entitled</th>
									<th class="px-3 py-3 text-right font-medium">Earned</th>
									<th class="px-3 py-3 text-right font-medium">Used</th>
									<th class="px-3 py-3 text-right font-medium">Pending</th>
									<th class="px-4 py-3 text-right font-medium text-foreground">Available</th>
								</tr>
							</thead>
							<tbody>
								{#each balanceRows as row (row.account.id)}
									<tr class="border-b last:border-0">
										<td class="px-4 py-3 font-medium text-foreground">{row.name}</td>
										<td class="px-4 py-3">
											<span class="font-medium text-foreground">{row.account.leave_name}</span>
											<span class="ml-2 text-xs text-muted-foreground"
												>{row.account.leave_code}{row.account.account_kind === 'EVENT'
													? ` · ${row.account.event_reference}`
													: ''}</span
											>
										</td>
										<td class="px-3 py-3 text-right tabular-nums"
											>{formatNumeric(row.summary.entitlement)}</td
										>
										<td class="px-3 py-3 text-right tabular-nums"
											>{row.account.accrual_kind === 'UNLIMITED'
												? '—'
												: formatNumeric(row.summary.earned + row.summary.carried)}</td
										>
										<td class="px-3 py-3 text-right tabular-nums"
											>{formatNumeric(row.summary.taken)}</td
										>
										<td class="px-3 py-3 text-right tabular-nums"
											>{formatNumeric(row.summary.pending)}</td
										>
										<td
											class="px-4 py-3 text-right text-base font-semibold tabular-nums text-foreground"
											>{row.account.accrual_kind === 'UNLIMITED'
												? 'Unmetered'
												: formatNumeric(row.summary.available)}</td
										>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if balanceRows.length === 0}
							<p class="p-6 text-sm text-muted-foreground">No generated accounts cover today.</p>
						{/if}
					</div>
				</Stack>
			{/if}
		</Scroll>
	</Bound>
{/snippet}

{#snippet requests()}
	{#if selectedCompanyId != null}
		<CollectionTable
			{client}
			collection="leave_requests"
			view={`hr_controller:leave:requests:${selectedCompanyId}`}
			recordMetadata={requestMetadata}
			query={{
				where: { leave_request_employment: { some: { company_id: { eq: selectedCompanyId } } } },
				orderBy: { from_date: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="employment_id" label="Employment" card="subtitle" />
				<Column name="leave_type_id" label="Leave type" card="title" />
				<Column name="event" label="Requested period" />
				<Column name="days" label="Days" />
				<Column name="certificate_file" label="Certificate" />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet policies()}
	{#if selectedCompanyId != null}
		<Stack gap="lg">
			<CollectionTable
				{client}
				collection="leave_plans"
				view={`hr_controller:leave:plans:${selectedCompanyId}`}
				title="Company leave plans"
				description="Prepare a draft version, then submit the one lifecycle change for manager approval."
				query={{
					where: { company_id: { eq: selectedCompanyId } },
					orderBy: { effective_range: 'desc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column name="code" card="title" />
					<Column name="name" card="subtitle" />
					<Column name="lifecycle" card="badge" />
					<Column name="transition" label="Mid-year treatment" />
					<Column name="effective_range" label="Effective period" />
				{/snippet}
			</CollectionTable>
			<CollectionTable
				{client}
				collection="leave_types"
				view={`hr_controller:leave:rules:${selectedCompanyId}`}
				title="Rules in plan versions"
				query={{ where: { company_id: { eq: selectedCompanyId } }, orderBy: { code: 'asc' } }}
			>
				{#snippet columns({ Column })}
					<Column name="code" card="title" />
					<Column name="name" card="subtitle" />
					<Column name="leave_plan_id" label="Plan version" />
					<Column name="statutory_kind" label="Statutory kind" />
					<Column name="account_basis" label="Basis" />
					<Column name="accrual" label="Accrual and carry" />
					<Column name="entitlement" label="Company entitlement" />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet accountsTab()}
	{#if selectedCompanyId != null}
		<CollectionTable
			{client}
			collection="leave_accounts"
			view={`hr_controller:leave:accounts:${selectedCompanyId}`}
			title="Sealed leave accounts"
			description="Year accounts are automatic. HR creates a reviewed event account only after verifying the qualifying event and allocation."
			query={{
				where: { leave_account_employment: { some: { company_id: { eq: selectedCompanyId } } } },
				orderBy: { starts_on: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="employment_id" label="Employment" />
				<Column name="leave_name" card="title" />
				<Column name="leave_code" card="subtitle" />
				<Column name="account_kind" label="Basis" />
				<Column name="event_reference" label="Event reference" />
				<Column name="leave_year" label="Year" />
				<Column name="entitlement_days" label="Calculated days" />
				<Column name="status" card="badge" />
				<Column name="starts_on" label="Starts" />
				<Column name="ends_on" label="Ends" />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet ledger()}
	{#if selectedCompanyId != null}
		<CollectionTable
			{client}
			collection="leave_entries"
			view={`hr_controller:leave:ledger:${selectedCompanyId}`}
			title="Leave ledger"
			description="System movements are automatic. Exceptional manual corrections append one reviewed entry."
			query={{
				where: {
					entry_leave_account: {
						some: { leave_account_employment: { some: { company_id: { eq: selectedCompanyId } } } }
					}
				},
				orderBy: { effective_on: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="kind" card="title" />
				<Column name="leave_account_id" label="Account" card="subtitle" />
				<Column name="effective_on" label="Effective" />
				<Column
					name="days"
					label="Movement"
					renderer={FormattedValueRenderer}
					rendererProps={{
						format: ({ value }) =>
							`${decodeNumber(value) > 0 ? '+' : ''}${formatNumeric(decodeNumber(value))}`
					}}
				/>
				<Column name="expires_on" label="Expires" />
				<Column name="reason" />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

<AppHeaderActions>{@render scopePicker()}</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{ name: 'overview', label: 'Balances', icon: 'lucide:gauge', content: overview },
			{ name: 'requests', label: 'Requests', icon: 'lucide:calendar-check-2', content: requests },
			{ name: 'policies', label: 'Plans & rules', icon: 'lucide:notebook-tabs', content: policies },
			{ name: 'accounts', label: 'Accounts', icon: 'lucide:wallet-cards', content: accountsTab },
			{ name: 'ledger', label: 'Ledger', icon: 'lucide:list-tree', content: ledger }
		] satisfies TabConfig[]}
	/>
</Cover>
