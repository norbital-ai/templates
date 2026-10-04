<script lang="ts">
	import Labelled from '../../lib/ui/components/Labelled.svelte';
	import { t } from '../../lib/ui/i18n/t.js';
	import { everyField } from '../../lib/every-field.js';
	/**
	 * Employee self-service: the signed-in person's profile and contract, their month (the plan, the clock and a missing
	 * punch to report), their leave balances and leave, claims, loans and payslips. Everything is scoped to the one
	 * employment they work in today; a person with several active contracts chooses one. The person is the employee row
	 * whose email is the signed-in member's (the grants scope every read to their own rows as well).
	 */
	import { bolt } from '$bolt';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/scopes/create-scope.js';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Cover, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Alert, Combobox, Table, Tabs } from '@norbital-ai/ui';
	import { inclusiveDays, shiftPeriod } from '../../lib/payroll/run/dates.js';
	import { coversDate } from '../../lib/payroll/run/effective.js';
	import { resolveEmployment } from '../../lib/employment-contract.js';
	import type { LeaveBalanceSummaries } from '../../lib/leave/summary.js';
	import { payRequestRecordMetadata } from '../../lib/scheduling/lock.js';
	import { payDateFor, todayKey } from '../../lib/ui/format/calendar.js';
	import ContractDetail from '../../lib/ui/contract/contract-detail.svelte';
	import {
		formatCalendarDate,
		formatLeaveSummary,
		formatNumeric
	} from '../../lib/ui/format/display-formatters.js';
	import { live, liveRows } from '../../lib/ui/state/live.svelte.js';
	import EmploymentMonth from '../../lib/ui/roster/employment-month.svelte';

	const today = todayKey();

	const employee = liveRows(() =>
		bolt.read('employees', {
			select: everyField('employees'),
			where: { email: { eq: { actor: 'email' } } },
			limit: 1
		})
	);
	const me = $derived(employee.current?.[0] ?? null);
	const companies = liveRows(() =>
		bolt.read('companies', {
			select: everyField('companies'),
			where: { approval_id: { isNull: true } },
			all: true
		})
	);
	const companyById = $derived(new Map((companies.current ?? []).map((row) => [row.id, row])));
	const contracts = liveRows(() =>
		me == null
			? null
			: bolt.read('employments', {
					select: everyField('employments'),
					where: { employee_id: { eq: me.id }, approval_id: { isNull: true } },
					all: true
				})
	);
	const active = $derived(
		(contracts.current ?? [])
			.map(resolveEmployment)
			.filter((row) => coversDate(row.effective_range, today))
	);
	let chosen = $state<Id<'employments'> | null>(null);
	const employment = $derived(
		active.length === 1 ? active[0] : active.find((row) => row.id === chosen)
	);
	const employmentId = $derived(employment?.id ?? null);
	/** The active contract as stored, whole: the Home tab shows every one of its fields. */
	const contract = $derived(
		(contracts.current ?? []).find((row) => row.id === employmentId) ?? null
	);
	const company = $derived(employment == null ? undefined : companyById.get(employment.company_id));
	const needsChoice = $derived(active.length > 1 && employment == null);
	// every request opened here is the viewer's own: the forms prefill their employment and never ask for the person
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => employmentId ?? undefined,
		employeeId: () => me?.id ?? undefined,
		companyId: () => employment?.company_id,
		settingsCode: () => company?.settings_code
	});
	/** Held false while a read is in flight, so the explanation cannot flash before the rows that contradict it. */
	const noEmployment = $derived(!employee.loading && !contracts.loading && active.length === 0);
	const employmentLabel = (row: { company_id: Id<'companies'>; employee_number: string }) =>
		`${companyById.get(row.company_id)?.name ?? t('app.hr_employee.company_fallback')}${t('app.hr_employee.employment_affiliation', { number: row.employee_number })}`;
	const choices = $derived(active.map((row) => ({ value: row.id, label: employmentLabel(row) })));

	/** The next pay date: the last day of this month, or of next month once it has passed. */
	const nextPayDate = $derived.by(() => {
		if (company == null) return null;
		const thisMonth = payDateFor(today.slice(0, 7));
		return thisMonth >= today ? thisMonth : payDateFor(shiftPeriod(today.slice(0, 7), 1));
	});
	const daysToPayday = $derived(
		nextPayDate == null ? null : Math.max(0, inclusiveDays(today, nextPayDate) - 1)
	);

	const balanceQuery = live(
		() =>
			employmentId == null
				? null
				: bolt.query('leave_entries.leave_balances', { employment_id: employmentId, as_of: today }),
		['leave_entries']
	);
	// The query answers `json`: its shape is `LeaveBalanceSummaries`, asserted where it enters.
	const balances = $derived({
		error: balanceQuery.error,
		current: balanceQuery.current as LeaveBalanceSummaries | undefined
	});
	type Held = {
		readonly approval_id: string | null;
		readonly payslip_id: unknown;
		readonly pay_period: string | null;
	};
	const lock = (row: Held) =>
		payRequestRecordMetadata(
			row.approval_id,
			row.payslip_id == null ? [] : [{ period: row.pay_period ?? '' }],
			t
		)[0]?.reason ?? '';
	const mine = $derived(
		employmentId == null ? { id: { in: [] } } : { employment_id: { eq: employmentId } }
	);
</script>

{#snippet lockCell({ row }: { row: Held })}<span class="text-xs text-muted-foreground"
		>{lock(row)}</span
	>{/snippet}
{#snippet summaryCell({ value }: { value: unknown })}{formatLeaveSummary(value, t)}{/snippet}

{#snippet gate()}
	{#if noEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-sm font-medium">{t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if active.length > 1}
		<Cluster class="rounded-xl border bg-card p-4 shadow-sm" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">
					{needsChoice ? t('app.hr_employee.choose_employment') : t('app.hr_employee.working_in')}
				</p>
				<p class="text-sm text-muted-foreground">
					{needsChoice || employment == null
						? t('app.hr_employee.choose_employment_description')
						: employmentLabel(employment)}
				</p>
			</Stack>
			<Labelled
				label={needsChoice
					? t('app.hr_employee.working_as')
					: t('app.hr_employee.switch_employment')}
				class="text-sm font-medium"
			>
				<Combobox
					class="w-64"
					size="sm"
					options={choices}
					value={employmentId}
					placeholder={t('app.hr_employee.choose_employment')}
					onChange={(id) => id != null && (chosen = id)}
				/>
			</Labelled>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Scroll name={t('app.hr_employee.tab_home')} inset>
		<Stack gap="md">
			{@render gate()}
			{#if employee.loading}
				<div
					class="h-56 animate-pulse rounded-lg bg-muted/40"
					aria-label={t('component.loading_profile')}
				></div>
			{:else if me != null}
				<section
					class="rounded-lg border bg-card shadow-card"
					aria-label={t('app.hr_employee.my_profile')}
				>
					<Cluster align="start" justify="between" gap="md" class="border-b bg-muted/30 px-5 py-4">
						<Stack gap="none">
							<p class="text-overline">{t('app.hr_employee.my_profile')}</p>
							<h2 class="text-heading">{me.name}</h2>
							<p class="text-sm text-muted-foreground">
								{company?.name ?? t('app.hr_employee.no_active_company')}{employment
									? t('app.hr_employee.employee_of', { number: employment.employee_number })
									: ''}
							</p>
						</Stack>
						{#if nextPayDate != null && daysToPayday != null}
							<Stack gap="none" class="text-right">
								<p class="text-xs font-medium text-muted-foreground">
									{t('app.hr_employee.next_payday')}
								</p>
								<p class="text-heading tabular-nums">
									{daysToPayday === 0
										? t('app.hr_employee.today')
										: t('app.hr_employee.days_until', { days: daysToPayday })}
								</p>
								<p class="text-meta">{formatCalendarDate(nextPayDate)}</p>
							</Stack>
						{/if}
					</Cluster>
					<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
					<Grid class="gap-px bg-border" gap="none" minimum="compact">
						{#each [[t('component.email'), me.email], [t('component.phone'), me.phone], [t('component.nationality'), me.nationality]] as [label, value] (label)}
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{label}</p>
								<p class="truncate text-sm font-medium">
									{value ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
						{/each}
					</Grid>
				</section>
				<!-- The contract, terms in force and revisions, read-only: HR edits, the person reads. -->
				{#if contract != null}
					<section
						class="rounded-lg border bg-card p-5 shadow-card"
						aria-label={t('app.hr_employee.my_contract')}
					>
						<Stack gap="md">
							<h2 class="text-heading">{t('app.hr_employee.my_contract')}</h2>
							<ContractDetail record={contract} />
						</Stack>
					</section>
				{/if}
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet scheduleIntro()}
	<Stack gap="md">
		{@render gate()}
		<Stack gap="none">
			<h2 class="text-heading">{t('app.hr_employee.my_schedule_title')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.hr_employee.my_schedule_description')}</p>
		</Stack>
	</Stack>
{/snippet}
{#snippet schedule()}
	<Cover gap="md" top={scheduleIntro}><EmploymentMonth {employmentId} selfService /></Cover>
{/snippet}

{#snippet leaveBalances()}
	<Scroll name={t('app.hr_employee.leave_scroll_name')} inset>
		{#if employmentId != null}
			<Stack gap="sm" as="section" aria-label={t('app.hr_employee.leave_balances')}>
				<h3 class="text-heading">{t('app.hr_employee.leave_balances')}</h3>
				<p class="text-meta">
					{t('app.hr_employee.leave_balances_description', { date: formatCalendarDate(today) })}
				</p>
				{#if balances.error}
					<Alert.Root variant="destructive"
						><Alert.Description>{balances.error}</Alert.Description></Alert.Root
					>
				{:else if balances.current == null}
					<p class="text-meta">{t('leave.loading_balances')}</p>
				{:else if balances.current.length === 0}
					<p class="text-meta">{t('app.hr_employee.leave_balances_empty')}</p>
				{:else}
					{#each balances.current as balance (balance.catalogue_id)}
						<Stack gap="sm" class="border-t py-3">
							<p class="text-sm font-medium">{balance.name} · {balance.code}</p>
							<p class="text-meta">
								{formatCalendarDate(balance.window.start)} → {formatCalendarDate(
									balance.window.end
								)}
							</p>
							<Grid as="dl" gap="sm" tracks="repeat(auto-fit, minmax(min(100%, 7rem), 1fr))">
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
							</Grid>
							{#each balance.warnings ?? [] as warning (warning)}
								<p class="text-meta">{warning}</p>
							{/each}
						</Stack>
					{/each}
				{/if}
			</Stack>
		{/if}
	</Scroll>
{/snippet}
{#snippet leaveApplications()}
	<Table
		of="leave_entries"
		key="my-leave"
		toolbar={{ title: t('app.hr_employee.my_leave_title'), new: employmentId != null }}
		where={mine}
		orderBy={{ effective_on: 'desc' }}
		columns={[
			{ field: 'catalogue_id', label: t('component.catalogue_leave') },
			{ field: 'summary', label: t('leave.activity'), cell: summaryCell },
			{ field: 'reference', label: t('component.reference') },
			{ field: 'days', label: t('component.days') },
			{ field: 'encash_days', label: t('component.encash_days') }
		]}
	/>
{/snippet}
{#snippet leave()}
	<Cover gap="md" top={gate}>
		<Tabs
			tabs={[
				{ name: 'balances', title: t('app.hr_employee.leave_tab_balances'), body: leaveBalances },
				{
					name: 'applications',
					title: t('app.hr_employee.leave_tab_applications'),
					body: leaveApplications
				}
			]}
		/>
	</Cover>
{/snippet}
{#snippet claims()}
	<Cover gap="md" top={gate}>
		<Table
			of="claim_requests"
			key="my-claims"
			toolbar={{ title: t('app.hr_employee.my_claims_title'), new: employmentId != null }}
			where={mine}
			orderBy={{ incurred_on: 'desc' }}
			columns={[
				{ field: 'catalogue_id', label: t('component.component') },
				{ field: 'amount', label: t('component.amount') },
				{ field: 'as_adjustment_entry', label: t('component.as_adjustment_entry') },
				{ field: 'incurred_on', label: t('component.incurred_on') },
				{ field: 'description', label: t('component.claim_description') },
				{ field: 'evidence_file', label: t('component.evidence_file') },
				{ field: 'approval_id', label: '', cell: lockCell }
			]}
		/>
	</Cover>
{/snippet}
{#snippet loans()}
	<Cover gap="md" top={gate}>
		<Table
			of="loans"
			key="my-loans"
			toolbar={{ title: t('app.hr_employee.my_loans_title'), new: false }}
			where={mine}
			initialFilter={{ effective_range: { contains: { today: '' } } }}
			orderBy={{ effective_from: 'desc' }}
			columns={[
				'reference',
				{ field: 'principal', label: t('component.principal') },
				'effective_range'
			]}
		/>
	</Cover>
{/snippet}
{#snippet events()}
	<Tabs
		tabs={[
			{ name: 'work', title: t('family.work'), icon: 'lucide:calendar-clock', body: schedule },
			{ name: 'leave', title: t('family.leave'), icon: 'lucide:calendar-check', body: leave },
			{ name: 'claim', title: t('family.claim'), icon: 'lucide:receipt-text', body: claims },
			{ name: 'loan', title: t('family.loan'), icon: 'lucide:landmark', body: loans }
		]}
	/>
{/snippet}
{#snippet payslips()}
	<Cover gap="md" top={gate}>
		<Table
			of="payslips"
			key="my-payslips"
			toolbar={{ title: t('app.hr_employee.my_payslips_title'), new: false }}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				{ field: 'payroll_run_id', label: t('app.hr_employee.pay_run') },
				{ field: 'status', label: t('component.status') },
				{ field: 'gross', label: t('component.gross') },
				{ field: 'total_deductions', label: t('component.deductions') },
				{ field: 'net', label: t('component.net') },
				'currency'
			]}
		/>
	</Cover>
{/snippet}

<AppShell
	icon="lucide:user-round"
	title={t('app.hr_employee.title')}
	description={t('app.hr_employee.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'home', title: t('app.hr_employee.tab_home'), icon: 'lucide:user-round', body: home },
			{
				name: 'events',
				title: t('app.hr_employee.tab_events'),
				icon: 'lucide:receipt',
				body: events
			},
			{
				name: 'payslips',
				title: t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				body: payslips
			}
		]}
	/>
</AppShell>
