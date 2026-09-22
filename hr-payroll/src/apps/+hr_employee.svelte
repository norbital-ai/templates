<script lang="ts">
	import { resolveEmployment } from '../lib/employment-contract.js';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../lib/workspace-client.js';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Bound, Cluster, Cover, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import EmploymentMonth from '../lib/ui/roster/employment-month.svelte';
	import ContractDetail from '../lib/ui/contract/contract-detail.svelte';
	import {
		formatCalendarDate,
		formatLeaveSummary,
		formatNumeric
	} from '../lib/ui/display-formatters.js';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type { LeaveBalanceSummaries } from '../lib/leave/summary.js';
	import {
		daysBetweenKeys,
		inForceTodayFilter,
		payDateFor,
		shiftMonthKey,
		todayKey
	} from '../lib/ui/calendar.js';
	import { coversDate } from '../collections/payroll_runs/lib/effective.js';
	import { payRequestRecordMetadata } from '../lib/scheduling/lock.js';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../lib/ui/create-scope.js';
	import EffectiveRangeRenderer from '../lib/ui/effective-range-renderer.svelte';

	const user = getPlatformStateContext()().user;
	const today = todayKey();

	const { t } = useI18n<TenantI18nKeys>();

	/** Every catalogue read on this page skips rows still held under an approval request. */
	const approved = { approval_id: { isNull: true } } as const;

	/**
	 * My loans opens on the agreements still being repaid today, as a filter chip the reader can drop
	 * to see settled ones.
	 */
	const employeeQuery = $derived(
		client.db.employees.findFirst({ where: { email: { eq: user.email } } })
	);
	const employeeId = $derived(employeeQuery.current?.id);
	const companiesQuery = $derived(
		client.db.companies.findMany({
			where: { approval_id: { isNull: true } },
			limit: 500
		})
	);
	const companyById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.id, company]))
	);
	const employmentsQuery = $derived(
		employeeId
			? client.db.employments.findMany({
					where: { employee_id: { eq: employeeId }, approval_id: { isNull: true } },
					limit: 10
				})
			: null
	);
	const activeEmployments = $derived(
		(employmentsQuery?.current ?? [])
			.map(resolveEmployment)
			.filter((employment) => coversDate(employment.effective_range, today))
	);
	let selectedEmploymentId = $state<string | null>(null);
	const employmentOptions = $derived(
		activeEmployments.map((employment) => ({
			value: employment.id,
			label: `${companyById.get(employment.company_id)?.name ?? t('app.hr_employee.company_fallback')}${t('app.hr_employee.employment_affiliation', { number: employment.employee_number })}`,
			search_term: `${companyById.get(employment.company_id)?.name ?? ''} ${employment.employee_number}`
		}))
	);
	const selectedEmployment = $derived(
		activeEmployments.find((employment) => employment.id === selectedEmploymentId)
	);
	const employmentId = $derived(
		activeEmployments.length === 1 ? activeEmployments[0]?.id : selectedEmployment?.id
	);
	const activeEmployment = $derived(
		activeEmployments.find((employment) => employment.id === employmentId)
	);
	/** The active contract as stored, whole: the Home tab shows every one of its fields. */
	const activeContract = $derived(
		(employmentsQuery?.current ?? []).find((employment) => employment.id === employmentId)
	);
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => employmentId,
		companyId: () => activeEmployment?.company_id,
		settingsCode: () =>
			activeEmployment == null
				? undefined
				: companyById.get(activeEmployment.company_id)?.settings_code
	});
	const needsEmploymentChoice = $derived(activeEmployments.length > 1 && !employmentId);
	/**
	 * Every surface on this page is scoped by `employmentId` — the four tables, and now the schedule
	 * calendar — so a reader with no active employment has nothing to scope to and each table is
	 * handed `disabled`. That disables the create button along with search, filter and refresh — and
	 * on its own it renders as a dead page whose greyed `New Leave Request` reads as "you are not
	 * allowed to do this", which is the one thing it does not mean. An employee who *does* hold an
	 * employment may create here; the create is gated on their direct manager, and a gated create is
	 * still a create.
	 *
	 * The calendar takes the same gate for the same reason and expresses it differently: it draws
	 * nothing at all rather than an empty month, because a month grid with no facts in it looks like
	 * a person who is rostered nothing, and that is a different and much more alarming claim than
	 * "HR has not opened your employment yet".
	 *
	 * The gate below states the real reason instead. It is held false while either query is still in
	 * flight so the explanation cannot flash before the rows that would contradict it. A resolved
	 * employee with no `employments` row and no employee row at all land in the same place, and
	 * correctly so: neither can be scoped to an employment, and both are fixed by HR, not by the
	 * reader.
	 */
	const employmentContextResolved = $derived(
		!employeeQuery.loading && !(employmentsQuery?.loading ?? false)
	);
	const hasNoActiveEmployment = $derived(
		employmentContextResolved && activeEmployments.length === 0
	);
	const company = $derived(
		activeEmployment ? companyById.get(activeEmployment.company_id) : undefined
	);

	type PayslipRow = WorkspaceRow<'payslips'> & {
		readonly payslip_payroll_run?: Pick<WorkspaceRow<'payroll_runs'>, 'period'> | null;
	};

	/**
	 * What holds one pay request of any family, from the row itself.
	 *
	 * Each of the four tables below carries its own `payslip_id` (and the slip in `with`), so the
	 * lock is a column of the row it locks rather than two page-level subscriptions walked into a
	 * Map. The families differ only
	 * in which relation key holds the capture, which is why the caller hands over the array and this
	 * function knows nothing about which collection it came from.
	 */
	type CapturedPayRequest = {
		readonly approval_id: string | null;
		readonly payslip_id: string | null;
		readonly pay_period?: string | null;
	};

	/** The settlement claim a captured pay request carries, in the shape the badge helper reads. */
	const capturesOf = (row: CapturedPayRequest) =>
		row.payslip_id == null ? [] : [{ period: row.pay_period ?? '' }];

	/** The next pay date: the last day of this month, or of next month once it has passed. */
	const nextPayDate = $derived.by(() => {
		if (!company) return null;
		const thisMonth = payDateFor(today.slice(0, 7));
		return thisMonth >= today ? thisMonth : payDateFor(shiftMonthKey(today.slice(0, 7), 1));
	});
	const daysToPayday = $derived(
		nextPayDate ? Math.max(0, daysBetweenKeys(today, nextPayDate)) : null
	);

	function payrollRunPeriod(row: PayslipRow): string {
		return row.payslip_payroll_run?.period ?? '—';
	}

	const leaveBalancesQuery = $derived(
		employmentId == null
			? null
			: (client.invoke.leave_balances({
					employment_id: employmentId,
					as_of: today
				}) as RemoteQuery<LeaveBalanceSummaries>)
	);
	const leaveBalanceRows = $derived(leaveBalancesQuery?.current ?? []);
</script>

{#snippet contextGate()}
	{#if hasNoActiveEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-sm font-medium">{t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if needsEmploymentChoice}
		<Stack gap="sm" class="rounded-xl border bg-card p-4 shadow-sm">
			<Stack gap="none">
				<p class="text-sm font-medium">{t('app.hr_employee.choose_employment')}</p>
				<p class="text-sm text-muted-foreground">
					{t('app.hr_employee.choose_employment_description')}
				</p>
			</Stack>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('app.hr_employee.working_as')}
					<Combobox
						options={employmentOptions}
						bind:value={selectedEmploymentId}
						searchPlaceholder={t('app.hr_employee.search_employment')}
						emptyPlaceholder={t('app.hr_employee.no_matching_employment')}
					/>
				</Stack>
			</label>
		</Stack>
	{:else if activeEmployments.length > 1 && selectedEmployment}
		<Cluster class="rounded-xl border bg-card p-4 shadow-sm" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">{t('app.hr_employee.working_in')}</p>
				<p class="text-sm text-muted-foreground">
					{companyById.get(selectedEmployment.company_id)?.name ??
						t('app.hr_employee.company_fallback')}
					{t('app.hr_employee.employment_affiliation', {
						number: selectedEmployment.employee_number
					})}
				</p>
			</Stack>
			<label class="w-full text-sm font-medium">
				<Stack gap="xs">
					{t('app.hr_employee.switch_employment')}
					<Combobox
						options={employmentOptions}
						bind:value={selectedEmploymentId}
						searchPlaceholder={t('app.hr_employee.search_employment')}
						emptyPlaceholder={t('app.hr_employee.no_matching_employment')}
					/>
				</Stack>
			</label>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Bound size="full">
		<Scroll name={t('app.hr_employee.tab_home')}>
			<Stack gap="md">
				{@render contextGate()}
				{#if employeeQuery.loading}
					<div
						class="h-56 animate-pulse rounded-lg bg-muted/40"
						aria-label={t('component.loading_profile')}
					></div>
				{:else if employeeQuery.current}
					<section
						class="rounded-lg border bg-card shadow-card"
						aria-labelledby="my-profile-heading"
					>
						<Cluster
							align="start"
							justify="between"
							gap="md"
							class="border-b bg-muted/30 px-5 py-4"
						>
							<Stack gap="none">
								<p class="text-overline">
									{t('app.hr_employee.my_profile')}
								</p>
								<h2 id="my-profile-heading" class="text-heading">
									{employeeQuery.current.name}
								</h2>
								<p class="text-sm text-muted-foreground">
									{company?.name ?? t('app.hr_employee.no_active_company')}{activeEmployment
										? t('app.hr_employee.employee_of', {
												number: activeEmployment.employee_number
											})
										: ''}
								</p>
							</Stack>
							{#if nextPayDate && daysToPayday != null}
								<Stack gap="none" class="text-right">
									<p class="text-xs font-medium text-muted-foreground">
										{t('app.hr_employee.next_payday')}
									</p>
									<p class="text-heading tabular-nums">
										{daysToPayday === 0
											? t('app.hr_employee.today')
											: t('app.hr_employee.days_until', { days: daysToPayday })}
									</p>
									<p class="text-meta">
										{formatCalendarDate(nextPayDate)}
									</p>
								</Stack>
							{/if}
						</Cluster>
						<!-- repository-health:allow UI10 -- 1px hairline gutters via bg-border are not on the gap scale -->
						<Grid class="gap-px bg-border" gap="none" minimum="compact">
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{t('component.email')}</p>
								<p class="truncate text-sm font-medium">{employeeQuery.current.email}</p>
							</Stack>
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{t('component.phone')}</p>
								<p class="text-sm font-medium">
									{employeeQuery.current.phone ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">
									{t('component.nationality')}
								</p>
								<p class="text-sm font-medium">
									{employeeQuery.current.nationality ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
						</Grid>
					</section>
					<!-- The contract, terms in force and revisions, read-only: HR edits, the person reads. -->
					{#if activeContract != null}
						<section
							class="rounded-lg border bg-card p-5 shadow-card"
							aria-labelledby="my-contract-heading"
						>
							<Stack gap="md">
								<h2 id="my-contract-heading" class="text-heading">
									{t('app.hr_employee.my_contract')}
								</h2>
								<ContractDetail record={activeContract} />
							</Stack>
						</section>
					{/if}
				{/if}
			</Stack>
		</Scroll>
	</Bound>
{/snippet}

{#snippet scheduleIntro()}
	<Stack gap="md">
		{@render contextGate()}
		<Stack gap="none">
			<h2 class="text-heading">{t('app.hr_employee.my_schedule_title')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.hr_employee.my_schedule_description')}</p>
		</Stack>
	</Stack>
{/snippet}

<!--
	THE CALENDAR IS THE BODY OF A `Cover`, and that is what stops it running off the screen.

	This tab used to be one `Stack`: heading, then a calendar roughly 700px tall. The tab panel around
	it is `h-full min-h-0 overflow-clip`, so on a 720px viewport the panel measured 552px, the content
	measured 871px, and the difference was not scrolled — it was CLIPPED. The last two weeks of every
	month and the whole legend were unreachable, with no scroll owner anywhere on the ancestor chain.

	`Cover` puts the chrome in an `auto` row and gives its body `minmax(0,1fr)`, which is the definite
	height the calendar's own `Scroll` needs to fill and stop at. The bound comes from the ancestor
	rather than from a `max-h-[100dvh-…]` on the calendar itself, which is the trap this codebase has
	already recorded: a fixed viewport-derived height rides up and clips itself at the page foot.

	`contextGate` inside the chrome has already explained a missing employment, in the words it chose
	for exactly this reason: a reader with no employment row is looking at missing HR data, not at a
	restriction on their access. Nothing further is drawn below, because there is no employment to
	scope a month to and a second empty state would only contradict the first.
-->
{#snippet schedule()}
	<Cover gap="md" top={scheduleIntro}>
		<EmploymentMonth {employmentId} selfService />
	</Cover>
{/snippet}

<!--
	THE BALANCES ARE THE BODY, NOT THE CHROME.

	`Cover` gives its chrome an `auto` row and its body `minmax(0,1fr)`. An `auto` row takes what its
	content asks for, so chrome that grows without bound takes everything and the body collapses —
	which is what a list of one card per leave type does. On an 800×450 walk the Cover measured 26px
	tall, its body measured 0, and 62px of content was CLIPPED with no scroll owner anywhere above
	it: the same fault the schedule tab records above, arriving from the other direction. There the
	body was too tall for the chrome's leftovers; here the chrome was too tall for the body.

	So the chrome is the one thing that is genuinely fixed — the sentence explaining a missing
	employment — and everything a reader scrolls through, balances and activity table alike, is the
	body inside a `Scroll` that the ancestor bounds.
-->
{#snippet leaveChrome()}
	<Stack gap="md">
		{@render contextGate()}
	</Stack>
{/snippet}

{#snippet leaveBalances()}
	{#if employmentId != null}
		<section aria-labelledby="my-leave-balances-heading">
			<Stack gap="sm">
				<h3 id="my-leave-balances-heading" class="text-heading">
					{t('app.hr_employee.leave_balances')}
				</h3>
				<p class="text-meta">
					{t('app.hr_employee.leave_balances_description', {
						date: formatCalendarDate(today)
					})}
				</p>
				{#if leaveBalancesQuery?.error}
					<Alert variant="destructive"
						><AlertDescription>{leaveBalancesQuery.error.message}</AlertDescription></Alert
					>
				{:else if leaveBalancesQuery?.loading && leaveBalancesQuery.current == null}
					<p class="text-meta">{t('leave.loading_balances')}</p>
				{:else if leaveBalanceRows.length === 0}
					<p class="text-meta">{t('app.hr_employee.leave_balances_empty')}</p>
				{:else}
					{#each leaveBalanceRows as balance (balance.catalogue_id)}
						<Stack gap="sm" class="border-t py-3">
							<p class="text-sm font-medium">{balance.name} · {balance.code}</p>
							<p class="text-meta">
								{formatCalendarDate(balance.window.start)} → {formatCalendarDate(
									balance.window.end
								)}
							</p>
							<dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
								{#each [{ label: t('app.hr_employee.leave_entitlement'), value: balance.entitlement }, { label: t('app.hr_employee.leave_earned'), value: balance.earned }, { label: t('leave.posted_balance'), value: balance.balance }, { label: t('app.hr_employee.leave_pending'), value: balance.pending }, { label: t('leave.expired_carry'), value: balance.expired }, { label: t('app.hr_employee.leave_available'), value: balance.available }] as item (item.label)}
									<div>
										<dt class="text-meta">{item.label}</dt>
										<dd class="text-sm font-medium tabular-nums">
											{item.value == null
												? t('component.accrual_unlimited')
												: formatNumeric(item.value)}
										</dd>
									</div>
								{/each}
							</dl>
						</Stack>
					{/each}
				{/if}
			</Stack>
		</section>
	{/if}
{/snippet}

{#snippet leave()}
	<Cover gap="md" top={leaveChrome}>
		<Scroll name={t('app.hr_employee.leave_scroll_name')}>
			<Stack gap="md">
				{@render leaveBalances()}
				<CollectionTable
					{client}
					collection="leave_entries"
					title={t('app.hr_employee.my_leave_title')}
					description={t('app.hr_employee.my_leave_description')}
					disabled={!employmentId}
					recordMetadata={() => [
						{ kind: 'restriction', operations: ['update', 'delete'], reason: t('leave.immutable') }
					]}
					query={{
						where: { employment_id: employmentId ? { eq: employmentId } : undefined },
						orderBy: { effective_on: 'desc' }
					}}
				>
					{#snippet columns({ Column })}
						<Column name="catalogue_id" label={t('component.catalogue_leave')} />
						<Column
							name="summary"
							label={t('leave.activity')}
							card="title"
							renderer={FormattedValueRenderer}
							rendererProps={{
								format: ({ row }: { row: { summary: unknown } }) =>
									formatLeaveSummary(row.summary, t)
							}}
						/>
						<Column name="reference" label={t('component.reference')} />
						<Column name="days" label={t('component.days')} />
						<Column name="encash_days" label={t('component.encash_days')} />
					{/snippet}
				</CollectionTable>
			</Stack>
		</Scroll>
	</Cover>
{/snippet}

{#snippet myClaims()}
	<CollectionTable
		{client}
		collection="claim_requests"
		view="hr_employee:claims"
		title={t('app.hr_employee.my_claims_title')}
		description={t('app.hr_employee.my_claims_description')}
		disabled={!employmentId}
		recordMetadata={(row: CapturedPayRequest) =>
			payRequestRecordMetadata(row.approval_id, capturesOf(row), t)}
		query={{
			where: { employment_id: employmentId ? { eq: employmentId } : undefined },
			orderBy: { incurred_on: 'desc' }
		}}
	>
		{#snippet columns({ Column })}
			<Column name="catalogue_id" label={t('component.component')} card="title" />
			<Column name="amount" label={t('component.amount')} />
			<Column name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
			<Column name="incurred_on" label={t('component.incurred_on')} />
			<Column name="description" card="subtitle" label={t('component.claim_description')} />
			<Column name="evidence_file" label={t('component.evidence_file')} />
		{/snippet}
	</CollectionTable>
{/snippet}

<!-- The panel never scrolls: the gate is the chrome of a `Cover`, the table is its body and scrolls. -->
{#snippet eventTable(content: import('svelte').Snippet)}
	<Cover gap="md" top={contextGate}>
		{@render content()}
	</Cover>
{/snippet}

{#snippet claimEvents()}{@render eventTable(myClaims)}{/snippet}

{#snippet events()}
	<Tabs
		animate={false}
		layout="vertical"
		config={[
			{ name: 'work', label: t('family.work'), icon: 'lucide:calendar-clock', content: schedule },
			{ name: 'leave', label: t('family.leave'), icon: 'lucide:calendar-check', content: leave },
			{
				name: 'claim',
				label: t('family.claim'),
				icon: 'lucide:receipt-text',
				content: claimEvents
			},
			{ name: 'loan', label: t('family.loan'), icon: 'lucide:landmark', content: loans }
		] satisfies TabConfig[]}
	/>
{/snippet}

{#snippet loans()}
	<Cover gap="md" top={contextGate}>
		<CollectionTable
			{client}
			collection="loans"
			view="hr_employee:loans"
			features={{ create: false }}
			title={t('app.hr_employee.my_loans_title')}
			description={t('app.hr_employee.my_loans_description')}
			disabled={!employmentId}
			initialFilters={inForceTodayFilter()}
			query={{
				where: {
					employment_id: employmentId ? { eq: employmentId } : undefined
				},
				orderBy: { effective_from: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="reference" card="title" />
				<Column name="principal" label={t('component.principal')} />
				<Column name="effective_range" renderer={EffectiveRangeRenderer} />
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

{#snippet payslips()}
	<Cover gap="md" top={contextGate}>
		<CollectionTable
			{client}
			collection="payslips"
			features={{ create: false }}
			title={t('app.hr_employee.my_payslips_title')}
			description={t('app.hr_employee.my_payslips_description')}
			disabled={!employmentId}
			query={{
				where: { employment_id: employmentId ? { eq: employmentId } : undefined },
				orderBy: { created_at: 'desc' },
				with: { payslip_payroll_run: { columns: { period: true } } }
			}}
		>
			{#snippet columns({ Column })}
				<Column
					name="payroll_run_id"
					label={t('app.hr_employee.pay_run')}
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ row }) => payrollRunPeriod(row) }}
				/>
				<Column name="status" label={t('component.status')} card="badge" />
				<Column name="gross" label={t('component.gross')} />
				<Column name="total_deductions" label={t('component.deductions')} />
				<Column name="net" label={t('component.net')} />
				<Column name="currency" />
			{/snippet}
			{#snippet ListCard(payslip)}
				<Stack gap="xs">
					<p class="truncate font-medium">{payrollRunPeriod(payslip)}</p>
					<p class="text-sm text-muted-foreground">
						{payslip.currency}
						{formatNumeric(payslip.net)}
					</p>
				</Stack>
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

<AppShell
	icon="lucide:user-round"
	title="Employee Self-Service"
	description="View your schedule, leave, pay requests, loans, payslips, and profile"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/hr_employee-banner.webp"
	variant="full"
>
	<Tabs
		animate={false}
		config={[
			{
				name: 'home',
				label: t('app.hr_employee.tab_home'),
				icon: 'lucide:user-round',
				content: home
			},
			{
				name: 'events',
				label: t('app.hr_employee.tab_events'),
				icon: 'lucide:receipt',
				content: events
			},
			{
				name: 'payslips',
				label: t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				content: payslips
			}
		] satisfies TabConfig[]}
	/>
</AppShell>
